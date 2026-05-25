import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistDir = path.resolve(__dirname, "../../web/dist");
const preloadPath = path.join(__dirname, "preload.js");
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

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
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
