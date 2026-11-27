const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adrianBits", {
  configure: (selection) => ipcRenderer.invoke("adrian-bits-configure", selection),
  onActivate(callback) {
    const activate = () => callback();
    ipcRenderer.on("adrian-bits-chat", activate);
    return () => ipcRenderer.removeListener("adrian-bits-chat", activate);
  },
});
