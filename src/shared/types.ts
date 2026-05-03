export type MediaKind = "image" | "video";
export type MediaOrientation = "landscape" | "portrait" | "square";

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
  likes: number;
  importedAt: number;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LibraryState {
  folders: FolderRecord[];
  items: MediaRecord[];
  scenarios: ScenarioRecord[];
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

export interface ScenarioPatch {
  name?: string;
  itemIds?: string[];
}

export interface OrientationUpdate {
  id: string;
  orientation: MediaOrientation;
}

export interface FolderPatch {
  name: string;
}
