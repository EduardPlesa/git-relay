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
  pushChanges,
  pullChanges,
  getRecentCommits,
  isGitRepo,
  getBranches,
  createBranch,
  checkoutBranch,
  discardFile,
  deleteBranch,
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

describe('discardFile', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('reverts an unstaged modification to a tracked file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    await discardFile(repoPath, 'committed.txt', true);
    const status = await getStatus(repoPath);
    expect(status.unstaged).toEqual([]);
    // git normalizes line endings on checkout per core.autocrlf, so compare
    // content ignoring CRLF vs LF rather than the exact bytes.
    const content = fs.readFileSync(path.join(repoPath, 'committed.txt'), 'utf8');
    expect(content.replace(/\r\n/g, '\n')).toBe('initial\n');
  });

  it('leaves staged content alone when discarding an unstaged edit on top of it', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'staged\n');
    const git = simpleGit(repoPath);
    await git.add('committed.txt');
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'staged then changed\n');

    await discardFile(repoPath, 'committed.txt', true);

    const status = await getStatus(repoPath);
    expect(status.unstaged).toEqual([]);
    expect(status.staged).toContain('committed.txt');
    const content = fs.readFileSync(path.join(repoPath, 'committed.txt'), 'utf8');
    expect(content.replace(/\r\n/g, '\n')).toBe('staged\n');
  });

  it('deletes an untracked file', async () => {
    fs.writeFileSync(path.join(repoPath, 'scratch.txt'), 'temp\n');
    await discardFile(repoPath, 'scratch.txt', false);
    expect(fs.existsSync(path.join(repoPath, 'scratch.txt'))).toBe(false);
  });
});

describe('deleteBranch', () => {
  let repoPath;
  let defaultBranch;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
    defaultBranch = (await simpleGit(repoPath).branchLocal()).current;
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('deletes a merged branch', async () => {
    await createBranch(repoPath, 'feature-c');
    await checkoutBranch(repoPath, defaultBranch);
    await deleteBranch(repoPath, 'feature-c');
    const branches = await getBranches(repoPath);
    expect(branches.all).not.toContain('feature-c');
  });

  it('refuses to delete the branch you are currently on', async () => {
    await expect(deleteBranch(repoPath, defaultBranch)).rejects.toThrow();
  });

  it('refuses to delete an unmerged branch', async () => {
    await createBranch(repoPath, 'feature-d');
    fs.writeFileSync(path.join(repoPath, 'unmerged.txt'), 'x\n');
    const git = simpleGit(repoPath);
    await git.add('unmerged.txt');
    await git.commit('unmerged work');
    await checkoutBranch(repoPath, defaultBranch);

    await expect(deleteBranch(repoPath, 'feature-d')).rejects.toThrow();
    const branches = await getBranches(repoPath);
    expect(branches.all).toContain('feature-d');
  });
});

describe('push/pull against a remote', () => {
  let tempPaths;

  beforeEach(() => {
    tempPaths = [];
  });

  afterEach(() => {
    for (const p of tempPaths) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  });

  async function makeRemote() {
    const remotePath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-remote-'));
    tempPaths.push(remotePath);
    await simpleGit(remotePath).init(['--bare']);
    return remotePath;
  }

  // Sets up a repo with `origin` pointed at a fresh bare remote, and does the
  // very first push through pushChanges() itself so its upstream-setting
  // behavior is exercised rather than assumed.
  async function makeRepoWithRemote() {
    const repoPath = await makeTestRepo();
    tempPaths.push(repoPath);
    const remotePath = await makeRemote();
    await simpleGit(repoPath).addRemote('origin', remotePath);
    await pushChanges(repoPath);
    return { repoPath, remotePath };
  }

  // Models a teammate: a second clone of the same remote that commits and
  // pushes, so the first repo has something new to fetch/pull/see as behind.
  async function pushFromASecondClone(remotePath, fileName, message) {
    const clonePath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-clone-'));
    tempPaths.push(clonePath);
    await simpleGit().clone(remotePath, clonePath);
    const git = simpleGit(clonePath);
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test User');
    fs.writeFileSync(path.join(clonePath, fileName), 'content\n');
    await git.add(fileName);
    await git.commit(message);
    await git.push();
  }

  it('pushChanges sets an upstream on the first push of a branch', async () => {
    const repoPath = await makeTestRepo();
    tempPaths.push(repoPath);
    const remotePath = await makeRemote();
    await simpleGit(repoPath).addRemote('origin', remotePath);

    await pushChanges(repoPath);

    const status = await getStatus(repoPath);
    expect(status.tracking).toBe(`origin/${status.branch}`);
  });

  it('reports ahead count for local commits not yet pushed', async () => {
    const { repoPath } = await makeRepoWithRemote();
    fs.writeFileSync(path.join(repoPath, 'local.txt'), 'x\n');
    const git = simpleGit(repoPath);
    await git.add('local.txt');
    await git.commit('local only');

    const status = await getStatus(repoPath);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(0);
  });

  it('reports behind count after fetching new remote commits', async () => {
    const { repoPath, remotePath } = await makeRepoWithRemote();
    await pushFromASecondClone(remotePath, 'remote.txt', 'remote only');
    await simpleGit(repoPath).fetch();

    const status = await getStatus(repoPath);
    expect(status.behind).toBe(1);
  });

  it('pullChanges merges new commits from the remote', async () => {
    const { repoPath, remotePath } = await makeRepoWithRemote();
    await pushFromASecondClone(remotePath, 'remote.txt', 'remote only');

    await pullChanges(repoPath);

    const commits = await getRecentCommits(repoPath, 10);
    expect(commits.map((c) => c.subject)).toContain('remote only');
  });
});
