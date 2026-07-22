const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentApi', {
  getPairingInfo: () => ipcRenderer.invoke('get-pairing-info'),
  setRepoPath: (repoPath) => ipcRenderer.invoke('set-repo-path', repoPath),
});
