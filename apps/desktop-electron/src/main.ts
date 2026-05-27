import { app, BrowserWindow, ipcMain } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
const webDistDir = path.resolve(__dirname, "../../web/dist");
const preloadPath = path.join(__dirname, "preload.js");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

interface UpdateInstallResult {
  ok: boolean;
  error?: string;
}

interface UpdateInstallOptions {
  source?: "gitee" | "github";
  feedUrl?: string;
}

let updateInstallPromise: Promise<UpdateInstallResult> | null = null;

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f2f0ea",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadFile(path.join(webDistDir, "index.html"));
}

app.whenReady().then(() => {
  registerUpdaterIpc();
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function registerUpdaterIpc() {
  ipcMain.handle("bomboard:install-update", (_event, options: UpdateInstallOptions) => (
    installUpdate(options)
  ));
}

function installUpdate(options: UpdateInstallOptions = {}): Promise<UpdateInstallResult> {
  if (!app.isPackaged) {
    return Promise.resolve({
      ok: false,
      error: "Automatic updates are only available in packaged builds."
    });
  }

  if (updateInstallPromise) return updateInstallPromise;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  configureUpdateFeed(options);

  updateInstallPromise = new Promise<UpdateInstallResult>(resolve => {
    const finish = (result: UpdateInstallResult) => {
      cleanup();
      updateInstallPromise = null;
      resolve(result);
    };

    const onDownloaded = () => {
      finish({ ok: true });
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 100);
    };

    const onNotAvailable = () => {
      finish({
        ok: false,
        error: "No installable update is available for this build."
      });
    };

    const onError = (error: Error) => {
      finish({
        ok: false,
        error: error.message || "Failed to install the update."
      });
    };

    const cleanup = () => {
      autoUpdater.off("update-downloaded", onDownloaded);
      autoUpdater.off("update-not-available", onNotAvailable);
      autoUpdater.off("error", onError);
    };

    autoUpdater.once("update-downloaded", onDownloaded);
    autoUpdater.once("update-not-available", onNotAvailable);
    autoUpdater.once("error", onError);
    autoUpdater.checkForUpdates().catch(onError);
  });

  return updateInstallPromise;
}

function configureUpdateFeed(options: UpdateInstallOptions) {
  if (options.source === "gitee" && options.feedUrl) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: options.feedUrl
    });
    return;
  }

  autoUpdater.setFeedURL({
    provider: "github",
    owner: "donnel666",
    repo: "BOMBoard"
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
