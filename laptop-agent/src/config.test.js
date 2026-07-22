import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, saveConfig } from './config.js';

describe('config load/save', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default config when file does not exist', () => {
    const config = loadConfig(configPath);
    expect(config).toEqual({ pairingToken: null, repoPath: null });
  });

  it('saves and reloads a config', () => {
    saveConfig(configPath, { pairingToken: 'abc123', repoPath: '/repo' });
    const reloaded = loadConfig(configPath);
    expect(reloaded).toEqual({ pairingToken: 'abc123', repoPath: '/repo' });
  });

  it('creates parent directories if missing', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'config.json');
    saveConfig(nestedPath, { pairingToken: 'x', repoPath: '/repo' });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
