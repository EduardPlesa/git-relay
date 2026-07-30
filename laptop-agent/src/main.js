require('dotenv').config();
const { app, Tray, Menu, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocketImpl = require('ws');
const QRCode = require('qrcode');
const { generateToken } = require('./pairing');
const { getConfigPath, loadConfig, saveConfig, addRepo, removeRepo } = require('./config');
const { createRelayClient } = require('./relayClient');
const { isGitRepo } = require('./gitOps');

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
  if (!config.pairingToken) return;
  if (relayChannel) return;

  // Electron's main process runs Node 20, which has no global WebSocket
  // (added in Node 22), so supabase-realtime needs an explicit implementation.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { realtime: { transport: WebSocketImpl } }
  );
  // Pass a getter, not the array: the relay reads repos fresh on each command,
  // so adding or removing a repo below takes effect live, no restart needed.
  relayChannel = createRelayClient(supabase, config.pairingToken, () => config.repos);
}

function openPairingWindow() {
  if (pairingWindow) {
    pairingWindow.focus();
    return;
  }
  pairingWindow = new BrowserWindow({
    width: 420,
    height: 520,
    // Electron 31 already defaults to all four, but the window renders a token
    // that grants git access — pin them so a future major can't silently relax
    // the renderer's isolation from Node.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  pairingWindow.loadFile(path.join(__dirname, 'pairingWindow.html'));
  pairingWindow.on('closed', () => {
    pairingWindow = null;
  });
}

ipcMain.handle('get-pairing-info', async () => {
  // Rendered here rather than in the window: qrcode ships no browser bundle
  // in this install, so the renderer gets a ready-made data URL instead.
  let qrDataUrl = null;
  if (config.pairingToken) {
    try {
      qrDataUrl = await QRCode.toDataURL(config.pairingToken, { width: 240 });
    } catch (error) {
      console.error('Failed to render pairing QR code:', error.message);
    }
  }
  return {
    pairingToken: config.pairingToken,
    repos: config.repos,
    qrDataUrl,
  };
});

// Add a repo by picking a folder. Rejects a folder that isn't a git repo so
// the phone never lists something that errors on every command.
ipcMain.handle('pick-repo', async () => {
  const result = await dialog.showOpenDialog(pairingWindow, {
    title: 'Choose a git repository',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { repos: config.repos };
  }
  const chosen = result.filePaths[0];
  if (!(await isGitRepo(chosen))) {
    return { repos: config.repos, error: `${chosen} is not a git repository.` };
  }
  config = addRepo(config, chosen);
  saveConfig(getConfigPath(), config);
  startRelay();
  return { repos: config.repos };
});

ipcMain.handle('remove-repo', (event, id) => {
  config = removeRepo(config, id);
  saveConfig(getConfigPath(), config);
  return { repos: config.repos };
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
