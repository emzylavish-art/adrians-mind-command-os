const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pet", {
  activate: () => ipcRenderer.send("adrian-bits-activate"),
  onSelection(callback) { ipcRenderer.on("adrian-bits-selection", (_event, selection) => callback(selection)); },
});
