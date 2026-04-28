export type MediaKind = "image" | "video";

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface MediaRecord {
  id: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  kind: MediaKind;
  size: number;
  folderId: string;
  tags: string[];
  importedAt: number;
}

export interface LibraryState {
  folders: FolderRecord[];
  items: MediaRecord[];
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  vaultPath: string;
}

export interface ImportResult {
  imported: MediaRecord[];
  skipped: string[];
}

export interface MediaPatch {
  folderId?: string;
  displayName?: string;
  tags?: string[];
}

export interface FolderPatch {
  name: string;
}
