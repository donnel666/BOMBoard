import { contextBridge, ipcRenderer } from "electron";

interface UpdateInstallResult {
  ok: boolean;
  error?: string;
}

interface UpdateInfo {
  version: string;
  url: string;
}

contextBridge.exposeInMainWorld("bomboard", {
  shell: "electron",
  updater: {
    install: (updateInfo: UpdateInfo) => (
      ipcRenderer.invoke("bomboard:install-update", updateInfo) as Promise<UpdateInstallResult>
    )
  }
});
