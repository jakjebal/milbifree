import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dialog } from "electron";
import type {
  FolderPatch,
  FolderRecord,
  ImportResult,
  LibraryState,
  MediaPatch,
  MediaRecord,
  VaultStatus
} from "../shared/types";

const ROOT_FOLDER_ID = "root";
const CONTAINER_MAGIC = Buffer.from("MLBI1");
const METADATA_FILE = "metadata.milbi";
const CONFIG_FILE = "config.json";
const FILES_DIR = "files";
const execFileAsync = promisify(execFile);

const KDF = {
  name: "scrypt",
  cost: 32768,
  blockSize: 8,
  parallelization: 1,
  maxmem: 128 * 1024 * 1024
} as const;

const MEDIA_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo"
};

interface VaultConfig {
  version: 1;
  createdAt: number;
  kdf: typeof KDF & { salt: string };
  verifier: string;
}

interface EncryptedHeader {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
}

function normalizeName(name: string, fallback: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : fallback;
}

function normalizeTags(tags: string[]): string[] {
  const clean = tags
    .map((tag) => tag.trim().replace(/^#/, "").replace(/\s+/g, " "))
    .filter(Boolean)
    .map((tag) => tag.slice(0, 40));
  return [...new Set(clean)].sort((a, b) => a.localeCompare(b));
}

function defaultLibrary(): LibraryState {
  return {
    folders: [
      {
        id: ROOT_FOLDER_ID,
        name: "라이브러리",
        parentId: null,
        createdAt: Date.now()
      }
    ],
    items: []
  };
}

function deriveKey(password: string, config: VaultConfig["kdf"]): Buffer {
  if (password.length < 8) {
    throw new Error("암호는 최소 8자 이상이어야 합니다.");
  }

  return crypto.scryptSync(password, Buffer.from(config.salt, "base64"), 32, {
    cost: config.cost,
    blockSize: config.blockSize,
    parallelization: config.parallelization,
    maxmem: config.maxmem
  });
}

function encryptBytes(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header: EncryptedHeader = {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const headerSize = Buffer.allocUnsafe(4);
  headerSize.writeUInt32BE(headerBytes.length, 0);
  return Buffer.concat([CONTAINER_MAGIC, headerSize, headerBytes, ciphertext]);
}

function decryptBytes(container: Buffer, key: Buffer): Buffer {
  if (
    container.length < CONTAINER_MAGIC.length + 4 ||
    !container.subarray(0, CONTAINER_MAGIC.length).equals(CONTAINER_MAGIC)
  ) {
    throw new Error("보관함 파일 형식이 올바르지 않습니다.");
  }

  const headerStart = CONTAINER_MAGIC.length + 4;
  const headerLength = container.readUInt32BE(CONTAINER_MAGIC.length);
  const headerEnd = headerStart + headerLength;
  const header = JSON.parse(container.subarray(headerStart, headerEnd).toString("utf8")) as EncryptedHeader;

  if (header.alg !== "aes-256-gcm") {
    throw new Error("지원하지 않는 암호화 형식입니다.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64"));
  return Buffer.concat([decipher.update(container.subarray(headerEnd)), decipher.final()]);
}

function encryptJson(value: unknown, key: Buffer): Buffer {
  return encryptBytes(Buffer.from(JSON.stringify(value), "utf8"), key);
}

function decryptJson<T>(container: Buffer, key: Buffer): T {
  return JSON.parse(decryptBytes(container, key).toString("utf8")) as T;
}

function mediaKindForMime(mimeType: string): MediaRecord["kind"] {
  return mimeType.startsWith("video/") ? "video" : "image";
}

export class VaultManager {
  private readonly vaultRoot: string;
  private readonly filesRoot: string;
  private key: Buffer | null = null;
  private library: LibraryState | null = null;

  constructor(userDataPath: string) {
    this.vaultRoot = path.join(userDataPath, "vault");
    this.filesRoot = path.join(this.vaultRoot, FILES_DIR);
  }

  async status(): Promise<VaultStatus> {
    return {
      exists: await this.exists(),
      unlocked: this.isUnlocked(),
      vaultPath: this.vaultRoot
    };
  }

  isUnlocked(): boolean {
    return this.key !== null && this.library !== null;
  }

  async create(password: string): Promise<LibraryState> {
    if (await this.exists()) {
      throw new Error("이미 보관함이 있습니다.");
    }

    await fs.mkdir(this.filesRoot, { recursive: true, mode: 0o700 });
    await this.prepareVaultDirectory();
    const salt = crypto.randomBytes(16).toString("base64");
    const config: VaultConfig = {
      version: 1,
      createdAt: Date.now(),
      kdf: { ...KDF, salt },
      verifier: ""
    };
    const key = deriveKey(password, config.kdf);
    config.verifier = encryptJson({ value: "milbi-vault" }, key).toString("base64");

    this.key = key;
    this.library = defaultLibrary();
    await fs.writeFile(this.configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
    await this.saveLibrary();
    return this.snapshot();
  }

  async unlock(password: string): Promise<LibraryState> {
    const config = await this.readConfig();
    const key = deriveKey(password, config.kdf);
    const verifier = decryptJson<{ value: string }>(Buffer.from(config.verifier, "base64"), key);
    if (verifier.value !== "milbi-vault") {
      throw new Error("암호가 올바르지 않습니다.");
    }

    const library = decryptJson<LibraryState>(await fs.readFile(this.metadataPath()), key);
    this.key = key;
    this.library = this.normalizeLibrary(library);
    return this.snapshot();
  }

  lock(): void {
    this.key = null;
    this.library = null;
  }

  getLibrary(): LibraryState {
    this.requireUnlocked();
    return this.snapshot();
  }

  async createFolder(name: string, parentId = ROOT_FOLDER_ID): Promise<LibraryState> {
    const library = this.requireUnlocked();
    const safeName = normalizeName(name, "새 폴더");
    if (!library.folders.some((folder) => folder.id === parentId)) {
      throw new Error("상위 폴더를 찾을 수 없습니다.");
    }

    library.folders.push({
      id: crypto.randomUUID(),
      name: safeName,
      parentId,
      createdAt: Date.now()
    });
    await this.saveLibrary();
    return this.snapshot();
  }

  async updateFolder(folderId: string, patch: FolderPatch): Promise<LibraryState> {
    const library = this.requireUnlocked();
    if (folderId === ROOT_FOLDER_ID) {
      throw new Error("기본 라이브러리 이름은 변경할 수 없습니다.");
    }
    const folder = library.folders.find((entry) => entry.id === folderId);
    if (!folder) {
      throw new Error("폴더를 찾을 수 없습니다.");
    }
    folder.name = normalizeName(patch.name, folder.name);
    await this.saveLibrary();
    return this.snapshot();
  }

  async deleteFolder(folderId: string): Promise<LibraryState> {
    const library = this.requireUnlocked();
    if (folderId === ROOT_FOLDER_ID) {
      throw new Error("기본 라이브러리는 삭제할 수 없습니다.");
    }
    if (library.folders.some((folder) => folder.parentId === folderId)) {
      throw new Error("하위 폴더가 있는 폴더는 삭제할 수 없습니다.");
    }
    if (library.items.some((item) => item.folderId === folderId)) {
      throw new Error("파일이 들어 있는 폴더는 삭제할 수 없습니다.");
    }
    library.folders = library.folders.filter((folder) => folder.id !== folderId);
    await this.saveLibrary();
    return this.snapshot();
  }

  async importMedia(folderId = ROOT_FOLDER_ID): Promise<ImportResult> {
    const library = this.requireUnlocked();
    if (!library.folders.some((folder) => folder.id === folderId)) {
      throw new Error("가져올 폴더를 찾을 수 없습니다.");
    }

    const result = await dialog.showOpenDialog({
      title: "이미지 또는 동영상 가져오기",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images and Videos",
          extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "mp4", "m4v", "mov", "webm", "mkv", "avi"]
        }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: [], skipped: [] };
    }

    const imported: MediaRecord[] = [];
    const skipped: string[] = [];

    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MEDIA_MIME[ext];
      if (!mimeType) {
        skipped.push(path.basename(filePath));
        continue;
      }

      try {
        const file = await fs.readFile(filePath);
        const item: MediaRecord = {
          id: crypto.randomUUID(),
          originalName: path.basename(filePath),
          displayName: path.basename(filePath),
          mimeType,
          kind: mediaKindForMime(mimeType),
          size: file.byteLength,
          folderId,
          tags: [],
          importedAt: Date.now()
        };
        await fs.writeFile(this.mediaPath(item.id), encryptBytes(file, this.requireKey()), { mode: 0o600 });
        library.items.push(item);
        imported.push(item);
      } catch {
        skipped.push(path.basename(filePath));
      }
    }

    if (imported.length > 0) {
      await this.saveLibrary();
    }

    return { imported, skipped };
  }

  async updateMedia(itemId: string, patch: MediaPatch): Promise<LibraryState> {
    const library = this.requireUnlocked();
    const item = this.findItem(itemId);
    if (patch.folderId !== undefined) {
      if (!library.folders.some((folder) => folder.id === patch.folderId)) {
        throw new Error("이동할 폴더를 찾을 수 없습니다.");
      }
      item.folderId = patch.folderId;
    }
    if (patch.displayName !== undefined) {
      item.displayName = normalizeName(patch.displayName, item.originalName);
    }
    if (patch.tags !== undefined) {
      item.tags = normalizeTags(patch.tags);
    }
    await this.saveLibrary();
    return this.snapshot();
  }

  async deleteMedia(itemId: string): Promise<LibraryState> {
    const library = this.requireUnlocked();
    const item = this.findItem(itemId);
    await fs.rm(this.mediaPath(item.id), { force: true });
    library.items = library.items.filter((entry) => entry.id !== itemId);
    await this.saveLibrary();
    return this.snapshot();
  }

  async readMedia(itemId: string): Promise<{ item: MediaRecord; bytes: Buffer }> {
    const item = this.findItem(itemId);
    const encrypted = await fs.readFile(this.mediaPath(itemId));
    return {
      item,
      bytes: decryptBytes(encrypted, this.requireKey())
    };
  }

  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath());
      return true;
    } catch {
      return false;
    }
  }

  private async readConfig(): Promise<VaultConfig> {
    try {
      return JSON.parse(await fs.readFile(this.configPath(), "utf8")) as VaultConfig;
    } catch {
      throw new Error("보관함 설정을 읽을 수 없습니다.");
    }
  }

  private requireUnlocked(): LibraryState {
    if (!this.library || !this.key) {
      throw new Error("먼저 보관함을 열어야 합니다.");
    }
    return this.library;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error("먼저 보관함을 열어야 합니다.");
    }
    return this.key;
  }

  private findItem(itemId: string): MediaRecord {
    const library = this.requireUnlocked();
    const item = library.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error("파일을 찾을 수 없습니다.");
    }
    return item;
  }

  private snapshot(): LibraryState {
    const library = this.requireUnlocked();
    return structuredClone(library);
  }

  private normalizeLibrary(library: LibraryState): LibraryState {
    const folders = library.folders?.length ? library.folders : defaultLibrary().folders;
    if (!folders.some((folder) => folder.id === ROOT_FOLDER_ID)) {
      folders.unshift(defaultLibrary().folders[0]);
    }
    return {
      folders,
      items: library.items ?? []
    };
  }

  private async saveLibrary(): Promise<void> {
    await fs.mkdir(this.filesRoot, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.metadataPath(), encryptJson(this.requireUnlocked(), this.requireKey()), { mode: 0o600 });
  }

  private configPath(): string {
    return path.join(this.vaultRoot, CONFIG_FILE);
  }

  private metadataPath(): string {
    return path.join(this.vaultRoot, METADATA_FILE);
  }

  private mediaPath(itemId: string): string {
    return path.join(this.filesRoot, `${itemId}.milbi`);
  }

  private async prepareVaultDirectory(): Promise<void> {
    try {
      await fs.writeFile(path.join(this.vaultRoot, ".metadata_never_index"), "", { flag: "a" });
    } catch {
      // Indexing hints are best-effort; encryption remains the primary protection.
    }

    if (process.platform === "win32") {
      try {
        await execFileAsync("attrib", ["+H", "+I", this.vaultRoot]);
      } catch {
        // Some Windows environments do not expose attrib to packaged apps.
      }
    }
  }
}
