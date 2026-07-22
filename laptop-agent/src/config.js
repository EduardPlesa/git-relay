const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigPath() {
  return path.join(os.homedir(), '.git-relay-agent', 'config.json');
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { pairingToken: null, repoPath: null };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function saveConfig(configPath, config) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { getConfigPath, loadConfig, saveConfig };
