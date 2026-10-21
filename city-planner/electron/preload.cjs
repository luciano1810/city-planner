const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('terrainAPI', {
  generate: options => ipcRenderer.invoke('terrain:generate', options),
  exportPNG: payload => ipcRenderer.invoke('terrain:export', payload),
  city: (action, payload) => ipcRenderer.invoke('city:request', { action, payload }),
  saveFile: payload => ipcRenderer.invoke('city:save-file', payload)
});
