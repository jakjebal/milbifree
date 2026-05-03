import { app, BrowserWindow, ipcMain, Menu, protocol, session } from "electron";
import path from "node:path";
import type { FolderPatch, MediaPatch, MediaRecord, OrientationUpdate, ScenarioPatch } from "../shared/types";
import { VaultManager } from "./vault";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "milbi",
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

app.setName("Milbi");
app.commandLine.appendSwitch("disable-http-cache");

let mainWindow: BrowserWindow | null = null;
let vault: VaultManager;

function mediaResponse(item: MediaRecord, bytes: Buffer, request: Request): Response {
  const size = bytes.byteLength;
  const baseHeaders: Record<string, string> = {
    "content-type": item.mimeType,
    "cache-control": "no-store, private, max-age=0",
    pragma: "no-cache",
    "accept-ranges": "bytes"
  };
  const range = request.headers.get("range");

  if (!range) {
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...baseHeaders,
        "content-length": String(size)
      }
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    return new Response("Invalid range", { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${size}` } });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Math.max(0, Number(match[2]));
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return new Response("Range not satisfiable", { status: 416, headers: { ...baseHeaders, "content-range": `bytes */${size}` } });
  }

  const safeEnd = Math.min(end, size - 1);
  const chunk = bytes.subarray(start, safeEnd + 1);
  return new Response(new Uint8Array(chunk), {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(chunk.byteLength),
      "content-range": `bytes ${start}-${safeEnd}/${size}`
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "Milbi",
    backgroundColor: "#111418",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  } else {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

function handle<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (_event, ...args: TArgs) => {
    try {
      return { ok: true, data: await listener(...args) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function registerIpc(): void {
  handle("vault:status", () => vault.status());
  handle("vault:chooseLocation", () => vault.chooseLocation(mainWindow));
  handle("vault:create", (password: string) => vault.create(password));
  handle("vault:unlock", (password: string) => vault.unlock(password));
  handle("vault:lock", () => {
    vault.lock();
    return vault.status();
  });
  handle("library:get", () => vault.getLibrary());
  handle("folder:create", (name: string, parentId?: string) => vault.createFolder(name, parentId));
  handle("folder:update", (folderId: string, patch: FolderPatch) => vault.updateFolder(folderId, patch));
  handle("folder:delete", (folderId: string) => vault.deleteFolder(folderId));
  handle("media:import", (folderId?: string) => vault.importMedia(folderId));
  handle("media:importPaths", (filePaths: string[], folderId?: string) => vault.importMediaPaths(filePaths, folderId));
  handle("media:like", (itemId: string) => vault.likeMedia(itemId));
  handle("media:adjustLikes", (itemIds: string[], delta: number) => vault.adjustMediaLikes(itemIds, delta));
  handle("media:setLikes", (itemIds: string[], likes: number) => vault.setMediaLikes(itemIds, likes));
  handle("media:addTags", (itemIds: string[], tags: string[]) => vault.addTagsToMedia(itemIds, tags));
  handle("tag:rename", (oldTag: string, nextTag: string) => vault.renameTag(oldTag, nextTag));
  handle("tag:delete", (tag: string) => vault.deleteTag(tag));
  handle("media:tagOrientations", (updates: OrientationUpdate[]) => vault.tagMediaOrientations(updates));
  handle("media:update", (itemId: string, patch: MediaPatch) => vault.updateMedia(itemId, patch));
  handle("media:delete", (itemId: string) => vault.deleteMedia(itemId));
  handle("scenario:create", (name: string) => vault.createScenario(name));
  handle("scenario:update", (scenarioId: string, patch: ScenarioPatch) => vault.updateScenario(scenarioId, patch));
  handle("scenario:delete", (scenarioId: string) => vault.deleteScenario(scenarioId));
  handle("viewer:fullscreen", (fullscreen: boolean) => {
    mainWindow?.setFullScreen(fullscreen);
    mainWindow?.setMenuBarVisibility(false);
    return mainWindow?.isFullScreen() ?? false;
  });
}

app.whenReady().then(async () => {
  vault = new VaultManager(app.getPath("userData"));
  await vault.init();
  Menu.setApplicationMenu(null);
  registerIpc();

  protocol.handle("milbi", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "media") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const itemId = decodeURIComponent(url.pathname.slice(1));
      const media = await vault.readMedia(itemId);
      return mediaResponse(media.item, media.bytes, request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  await session.defaultSession.clearCache();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});

app.on("window-all-closed", () => {
  vault?.lock();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
