import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("bomboard", {
  shell: "electron"
});
