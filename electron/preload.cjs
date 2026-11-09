const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("netTool", {
  openWebsite: () => ipcRenderer.invoke("window:openWebsite"),
  load: () => ipcRenderer.invoke("workspace:load"),
  save: (patch) => ipcRenderer.invoke("workspace:save", patch),
  exportExcel: (mode, projectId) =>
    ipcRenderer.invoke("excel:export", mode, projectId),
  importExcel: () => ipcRenderer.invoke("excel:import"),
  interfaces: () => ipcRenderer.invoke("network:interfaces"),
  start: (kind, options) => ipcRenderer.invoke("task:start", kind, options),
  control: (id, action) => ipcRenderer.invoke("task:control", id, action),
  copy: (content) => ipcRenderer.invoke("clipboard:write", content),
  export: (name, content) => ipcRenderer.invoke("file:export", name, content),
  import: () => ipcRenderer.invoke("file:import"),
  onTask: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on("task:event", listener);
    return () => ipcRenderer.removeListener("task:event", listener);
  },
});
