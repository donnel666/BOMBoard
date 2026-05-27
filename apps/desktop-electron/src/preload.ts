import { contextBridge, ipcRenderer } from "electron";

interface UpdateInstallResult {
  ok: boolean;
  error?: string;
}

contextBridge.exposeInMainWorld("bomboard", {
  shell: "electron",
  updater: {
    install: () => ipcRenderer.invoke("bomboard:install-update") as Promise<UpdateInstallResult>
  }
});
