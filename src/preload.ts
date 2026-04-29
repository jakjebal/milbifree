import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FolderPatch, ImportResult, LibraryState, MediaPatch, OrientationUpdate, VaultStatus } from "./shared/types";

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

contextBridge.exposeInMainWorld("milbi", {
  getStatus: () => invoke<VaultStatus>("vault:status"),
  chooseVaultLocation: () => invoke<VaultStatus>("vault:chooseLocation"),
  createVault: (password: string) => invoke<LibraryState>("vault:create", password),
  unlockVault: (password: string) => invoke<LibraryState>("vault:unlock", password),
  lockVault: () => invoke<VaultStatus>("vault:lock"),
  getLibrary: () => invoke<LibraryState>("library:get"),
  createFolder: (name: string, parentId?: string) => invoke<LibraryState>("folder:create", name, parentId),
  updateFolder: (folderId: string, patch: FolderPatch) => invoke<LibraryState>("folder:update", folderId, patch),
  deleteFolder: (folderId: string) => invoke<LibraryState>("folder:delete", folderId),
  importMedia: (folderId?: string) => invoke<ImportResult>("media:import", folderId),
  importDroppedMedia: (filePaths: string[], folderId?: string) => invoke<ImportResult>("media:importPaths", filePaths, folderId),
  likeMedia: (itemId: string) => invoke<LibraryState>("media:like", itemId),
  addTagsToMedia: (itemIds: string[], tags: string[]) => invoke<LibraryState>("media:addTags", itemIds, tags),
  tagMediaOrientations: (updates: OrientationUpdate[]) => invoke<LibraryState>("media:tagOrientations", updates),
  updateMedia: (itemId: string, patch: MediaPatch) => invoke<LibraryState>("media:update", itemId, patch),
  deleteMedia: (itemId: string) => invoke<LibraryState>("media:delete", itemId),
  setViewerFullscreen: (fullscreen: boolean) => invoke<boolean>("viewer:fullscreen", fullscreen),
  mediaSrc: (itemId: string) => `milbi://media/${encodeURIComponent(itemId)}`,
  filePathFor: (file: File) => webUtils.getPathForFile(file)
});
