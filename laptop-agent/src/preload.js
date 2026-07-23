const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentApi', {
  getPairingInfo: () => ipcRenderer.invoke('get-pairing-info'),
  pickRepo: () => ipcRenderer.invoke('pick-repo'),
  removeRepo: (id) => ipcRenderer.invoke('remove-repo', id),
});
