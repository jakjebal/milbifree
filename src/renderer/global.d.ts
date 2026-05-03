import type { FolderPatch, ImportResult, LibraryState, MediaPatch, OrientationUpdate, ScenarioPatch, VaultStatus } from "../shared/types";

export {};

declare global {
  interface Window {
    milbi: {
      getStatus: () => Promise<VaultStatus>;
      chooseVaultLocation: () => Promise<VaultStatus>;
      createVault: (password: string) => Promise<LibraryState>;
      unlockVault: (password: string) => Promise<LibraryState>;
      lockVault: () => Promise<VaultStatus>;
      getLibrary: () => Promise<LibraryState>;
      createFolder: (name: string, parentId?: string) => Promise<LibraryState>;
      updateFolder: (folderId: string, patch: FolderPatch) => Promise<LibraryState>;
      deleteFolder: (folderId: string) => Promise<LibraryState>;
      importMedia: (folderId?: string) => Promise<ImportResult>;
      importDroppedMedia: (filePaths: string[], folderId?: string) => Promise<ImportResult>;
      likeMedia: (itemId: string) => Promise<LibraryState>;
      adjustMediaLikes: (itemIds: string[], delta: number) => Promise<LibraryState>;
      setMediaLikes: (itemIds: string[], likes: number) => Promise<LibraryState>;
      addTagsToMedia: (itemIds: string[], tags: string[]) => Promise<LibraryState>;
      renameTag: (oldTag: string, nextTag: string) => Promise<LibraryState>;
      deleteTag: (tag: string) => Promise<LibraryState>;
      tagMediaOrientations: (updates: OrientationUpdate[]) => Promise<LibraryState>;
      updateMedia: (itemId: string, patch: MediaPatch) => Promise<LibraryState>;
      deleteMedia: (itemId: string) => Promise<LibraryState>;
      createScenario: (name: string) => Promise<LibraryState>;
      updateScenario: (scenarioId: string, patch: ScenarioPatch) => Promise<LibraryState>;
      deleteScenario: (scenarioId: string) => Promise<LibraryState>;
      setViewerFullscreen: (fullscreen: boolean) => Promise<boolean>;
      mediaSrc: (itemId: string) => string;
      filePathFor: (file: File) => string;
    };
  }
}
