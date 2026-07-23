import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import {
  getStatus,
  getDiff,
  stageFiles,
  commitChanges,
  getRecentCommits,
  isGitRepo,
  getBranches,
  createBranch,
  checkoutBranch,
} from './gitOps.js';

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

  it('reports the current branch', async () => {
    const git = simpleGit(repoPath);
    const summary = await git.branchLocal();
    const status = await getStatus(repoPath);
    expect(status.branch).toBe(summary.current);
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

describe('getRecentCommits', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns commits newest first with a short hash and subject', async () => {
    const git = simpleGit(repoPath);
    fs.writeFileSync(path.join(repoPath, 'second.txt'), 'two\n');
    await git.add('second.txt');
    await git.commit('add second file');

    const commits = await getRecentCommits(repoPath, 10);
    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toBe('add second file');
    expect(commits[1].subject).toBe('initial commit');
    expect(commits[0].shortHash).toMatch(/^[0-9a-f]{7}$/);
    expect(commits[0].hash.startsWith(commits[0].shortHash)).toBe(true);
    expect(commits[0].author).toBe('Test User');
  });

  it('honours the count limit', async () => {
    const git = simpleGit(repoPath);
    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(path.join(repoPath, `f${i}.txt`), `${i}\n`);
      await git.add(`f${i}.txt`);
      await git.commit(`commit ${i}`);
    }
    const commits = await getRecentCommits(repoPath, 2);
    expect(commits).toHaveLength(2);
  });
});

describe('isGitRepo', () => {
  it('is true inside a git repo', async () => {
    const repoPath = await makeTestRepo();
    try {
      expect(await isGitRepo(repoPath)).toBe(true);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  it('is false for a plain folder', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-plain-'));
    try {
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('branches', () => {
  let repoPath;
  let defaultBranch;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
    defaultBranch = (await simpleGit(repoPath).branchLocal()).current;
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('lists the default branch as current', async () => {
    const branches = await getBranches(repoPath);
    expect(branches.current).toBe(defaultBranch);
    expect(branches.all).toContain(defaultBranch);
  });

  it('creates a branch off HEAD and switches to it', async () => {
    await createBranch(repoPath, 'feature-a');
    const branches = await getBranches(repoPath);
    expect(branches.current).toBe('feature-a');
    expect(branches.all).toContain(defaultBranch);
    expect(branches.all).toContain('feature-a');
  });

  it('creates a branch off a given ref without moving the ref branch', async () => {
    const git = simpleGit(repoPath);
    const firstCommit = (await git.log({ maxCount: 1 })).latest.hash;
    fs.writeFileSync(path.join(repoPath, 'second.txt'), 'two\n');
    await git.add('second.txt');
    await git.commit('add second file');

    await createBranch(repoPath, 'from-first', firstCommit);
    const commits = await getRecentCommits(repoPath, 10);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('initial commit');

    const branches = await getBranches(repoPath);
    expect(branches.current).toBe('from-first');
  });

  it('checks out an existing branch', async () => {
    await createBranch(repoPath, 'feature-b');
    await checkoutBranch(repoPath, defaultBranch);
    const branches = await getBranches(repoPath);
    expect(branches.current).toBe(defaultBranch);
  });
});
