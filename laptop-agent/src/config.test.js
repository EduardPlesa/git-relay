import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, saveConfig, addRepo, removeRepo, repoName } from './config.js';

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
    expect(loadConfig(configPath)).toEqual({ pairingToken: null, repos: [] });
  });

  it('saves and reloads a config', () => {
    const repos = [{ id: 'r1', name: 'app', path: '/repo/app' }];
    saveConfig(configPath, { pairingToken: 'abc123', repos });
    expect(loadConfig(configPath)).toEqual({ pairingToken: 'abc123', repos });
  });

  it('creates parent directories if missing', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'config.json');
    saveConfig(nestedPath, { pairingToken: 'x', repos: [] });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('migrates a single repoPath from the pre-multi-repo format', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ pairingToken: 'abc', repoPath: '/home/me/project' })
    );
    const config = loadConfig(configPath);

    expect(config.pairingToken).toBe('abc');
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]).toMatchObject({ name: 'project', path: '/home/me/project' });
  });
});

describe('addRepo', () => {
  it('adds a repo, deriving its name from the folder', () => {
    const config = addRepo({ pairingToken: 't', repos: [] }, '/home/me/my-app');
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]).toMatchObject({ name: 'my-app', path: '/home/me/my-app' });
    expect(config.repos[0].id).toBeTruthy();
  });

  it('keeps several repos side by side', () => {
    let config = addRepo({ pairingToken: 't', repos: [] }, '/a/one');
    config = addRepo(config, '/b/two');
    expect(config.repos.map((r) => r.path)).toEqual(['/a/one', '/b/two']);
  });

  it('does not add the same path twice', () => {
    let config = addRepo({ pairingToken: 't', repos: [] }, '/a/one');
    config = addRepo(config, '/a/one');
    expect(config.repos).toHaveLength(1);
  });

  it('ignores an empty path', () => {
    const config = addRepo({ pairingToken: 't', repos: [] }, '   ');
    expect(config.repos).toHaveLength(0);
  });
});

describe('removeRepo', () => {
  it('removes only the matching repo', () => {
    let config = addRepo({ pairingToken: 't', repos: [] }, '/a/one');
    config = addRepo(config, '/b/two');
    const firstId = config.repos[0].id;
    config = removeRepo(config, firstId);

    expect(config.repos).toHaveLength(1);
    expect(config.repos[0].path).toBe('/b/two');
  });
});

describe('repoName', () => {
  it('takes the last segment and tolerates trailing slashes', () => {
    expect(repoName('/home/me/project/')).toBe('project');
    expect(repoName('C:\\code\\thing')).toBe('thing');
  });
});
