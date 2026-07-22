require('dotenv').config();
const { app, Tray, Menu, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocketImpl = require('ws');
const { generateToken } = require('./pairing');
const { getConfigPath, loadConfig, saveConfig } = require('./config');
const { createRelayClient } = require('./relayClient');

let tray = null;
let pairingWindow = null;
let config = null;
let relayChannel = null;

function ensurePairingToken() {
  if (!config.pairingToken) {
    config.pairingToken = generateToken();
    saveConfig(getConfigPath(), config);
  }
}

function startRelay() {
  if (!config.pairingToken || !config.repoPath) return;
  if (relayChannel) return;

  // Electron's main process runs Node 20, which has no global WebSocket
  // (added in Node 22), so supabase-realtime needs an explicit implementation.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { realtime: { transport: WebSocketImpl } }
  );
  relayChannel = createRelayClient(supabase, config.pairingToken, config.repoPath);
}

function openPairingWindow() {
  if (pairingWindow) {
    pairingWindow.focus();
    return;
  }
  pairingWindow = new BrowserWindow({
    width: 420,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  pairingWindow.loadFile(path.join(__dirname, 'pairingWindow.html'));
  pairingWindow.on('closed', () => {
    pairingWindow = null;
  });
}

ipcMain.handle('get-pairing-info', () => {
  return { pairingToken: config.pairingToken, repoPath: config.repoPath };
});

ipcMain.handle('set-repo-path', (event, repoPath) => {
  config.repoPath = repoPath;
  saveConfig(getConfigPath(), config);
  // startRelay() no-ops once relayChannel exists, so changing the repo path
  // after the relay is already running only takes effect on next app restart.
  if (relayChannel) {
    console.warn('Repo path changed while relay is active — restart the app to apply it.');
  }
  startRelay();
  return config;
});

app.whenReady().then(() => {
  config = loadConfig(getConfigPath());
  ensurePairingToken();
  startRelay();

  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));
  tray.setToolTip('Git Relay Agent');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Pairing & Settings', click: openPairingWindow },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
