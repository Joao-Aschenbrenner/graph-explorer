const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("graphExplorer", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),

  scanWorkspace: (root) => ipcRenderer.invoke("workspace:scan", root),

  loadConfig: () => ipcRenderer.invoke("config:load"),

  saveConfig: (config) => ipcRenderer.invoke("config:save", config),

  disableAI: (config) => ipcRenderer.invoke("config:disable-ai", config),

  detectGraphify: () => ipcRenderer.invoke("graphify:detect"),

  testProvider: (config) => ipcRenderer.invoke("provider:test", config),

  runGraphify: (request) => ipcRenderer.invoke("graphify:run", request),

  cancelGraphify: (jobId) => ipcRenderer.invoke("graphify:cancel", jobId),

  onGraphifyEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("graphify:event", listener);
    return () => ipcRenderer.removeListener("graphify:event", listener);
  },
});
