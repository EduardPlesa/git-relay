const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function getConfigPath() {
  return path.join(os.homedir(), '.git-relay-agent', 'config.json');
}

/**
 * Last path segment, used as a friendly repo name when the phone lists repos.
 * Splits on both separators regardless of host OS, so a Windows path handled on
 * a POSIX box (or vice versa) still yields the folder name rather than the whole
 * string.
 */
function repoName(repoPath) {
  const segments = String(repoPath).split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || String(repoPath);
}

// The agent used to hold a single `repoPath`. It now keeps a list of repos so
// one paired phone can pick which one to work in. `normalize` accepts either
// shape and always returns the new one, migrating a lone repoPath in place.
function normalize(raw) {
  let repos = Array.isArray(raw.repos) ? raw.repos : [];
  if (!Array.isArray(raw.repos) && raw.repoPath) {
    repos = [{ id: crypto.randomUUID(), name: repoName(raw.repoPath), path: raw.repoPath }];
  }
  return { pairingToken: raw.pairingToken ?? null, repos };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { pairingToken: null, repos: [] };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return normalize(JSON.parse(raw));
}

function saveConfig(configPath, config) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/** Adds a repo, or returns the config unchanged if that path is already listed. */
function addRepo(config, repoPath) {
  const trimmed = String(repoPath || '').trim();
  if (!trimmed) return config;
  if (config.repos.some((r) => r.path === trimmed)) return config;
  const repo = { id: crypto.randomUUID(), name: repoName(trimmed), path: trimmed };
  return { ...config, repos: [...config.repos, repo] };
}

function removeRepo(config, id) {
  return { ...config, repos: config.repos.filter((r) => r.id !== id) };
}

module.exports = { getConfigPath, loadConfig, saveConfig, addRepo, removeRepo, repoName };
