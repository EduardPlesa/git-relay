import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { getStatus, getDiff, stageFiles, commitChanges } from './gitOps.js';

async function makeTestRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-repo-'));
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'initial\n');
  await git.add('committed.txt');
  await git.commit('initial commit');
  return repoPath;
}

describe('getStatus', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('detects an untracked file', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    const status = await getStatus(repoPath);
    expect(status.untracked).toContain('new.txt');
    expect(status.staged).toEqual([]);
  });

  it('detects an unstaged modification', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const status = await getStatus(repoPath);
    expect(status.unstaged).toContain('committed.txt');
  });

  it('detects a staged file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const git = simpleGit(repoPath);
    await git.add('committed.txt');
    const status = await getStatus(repoPath);
    expect(status.staged).toContain('committed.txt');
    expect(status.unstaged).not.toContain('committed.txt');
  });
});

describe('getDiff', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns unstaged diff text for a modified file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const diff = await getDiff(repoPath, 'committed.txt', false);
    expect(diff).toContain('-initial');
    expect(diff).toContain('+changed');
  });

  it('returns staged diff text for a staged file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const git = simpleGit(repoPath);
    await git.add('committed.txt');
    const diff = await getDiff(repoPath, 'committed.txt', true);
    expect(diff).toContain('-initial');
    expect(diff).toContain('+changed');
  });
});

describe('stageFiles and commitChanges', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('stages the given files', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    await stageFiles(repoPath, ['new.txt']);
    const status = await getStatus(repoPath);
    expect(status.staged).toContain('new.txt');
  });

  it('commits staged changes and returns a commit hash', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    await stageFiles(repoPath, ['new.txt']);
    const commitHash = await commitChanges(repoPath, 'add new.txt');
    expect(commitHash).toMatch(/^[0-9a-f]{7,40}$/);
    const status = await getStatus(repoPath);
    expect(status.staged).toEqual([]);
    expect(status.untracked).toEqual([]);
  });
});
