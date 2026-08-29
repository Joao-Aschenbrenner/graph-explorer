const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("graphExplorer", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),

  scanWorkspace: (root) => ipcRenderer.invoke("workspace:scan", root),

  loadGraphData: (projectPath) => ipcRenderer.invoke("graph:data", projectPath),

  loadConfig: () => ipcRenderer.invoke("config:load"),

  saveConfig: (config) => ipcRenderer.invoke("config:save", config),

  disableAI: (config) => ipcRenderer.invoke("config:disable-ai", config),

  detectGraphify: () => ipcRenderer.invoke("graphify:detect"),

  installGraphify: () => ipcRenderer.invoke("graphify:install"),

  listModels: (config) => ipcRenderer.invoke("provider:models", config),

  testProvider: (config) => ipcRenderer.invoke("provider:test", config),

  runGraphify: (request) => ipcRenderer.invoke("graphify:run", request),

  cancelGraphify: (jobId) => ipcRenderer.invoke("graphify:cancel", jobId),

  getUpdateStatus: () => ipcRenderer.invoke("update:status"),

  checkForUpdates: () => ipcRenderer.invoke("update:check"),

  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },

  onGraphifyEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("graphify:event", listener);
    return () => ipcRenderer.removeListener("graphify:event", listener);
  },
});
