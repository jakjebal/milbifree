import { app, BrowserWindow, ipcMain, Menu, protocol, session } from "electron";
import path from "node:path";
import type { FolderPatch, MediaPatch } from "../shared/types";
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
  handle("media:import", async (folderId?: string) => {
    const result = await vault.importMedia(folderId);
    app.clearRecentDocuments();
    return result;
  });
  handle("media:importPaths", async (filePaths: string[], folderId?: string) => {
    const result = await vault.importMediaPaths(filePaths, folderId);
    app.clearRecentDocuments();
    return result;
  });
  handle("media:update", (itemId: string, patch: MediaPatch) => vault.updateMedia(itemId, patch));
  handle("media:delete", (itemId: string) => vault.deleteMedia(itemId));
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
      return new Response(new Uint8Array(media.bytes), {
        headers: {
          "content-type": media.item.mimeType,
          "cache-control": "no-store, private, max-age=0",
          pragma: "no-cache"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  await session.defaultSession.clearCache();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});

app.on("browser-window-focus", () => {
  app.clearRecentDocuments();
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
