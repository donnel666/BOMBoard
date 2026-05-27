import { contextBridge, ipcRenderer } from "electron";

interface UpdateInstallResult {
  ok: boolean;
  error?: string;
}

interface UpdateInfo {
  source: "gitee" | "github";
  feedUrl?: string;
}

contextBridge.exposeInMainWorld("bomboard", {
  shell: "electron",
  updater: {
    install: (updateInfo: UpdateInfo) => (
      ipcRenderer.invoke("bomboard:install-update", updateInfo) as Promise<UpdateInstallResult>
    )
  }
});
