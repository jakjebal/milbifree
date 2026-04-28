import type { FolderPatch, ImportResult, LibraryState, MediaPatch, VaultStatus } from "../shared/types";

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
      updateMedia: (itemId: string, patch: MediaPatch) => Promise<LibraryState>;
      deleteMedia: (itemId: string) => Promise<LibraryState>;
      mediaSrc: (itemId: string) => string;
      filePathFor: (file: File) => string;
    };
  }
}
