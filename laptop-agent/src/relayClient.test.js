import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

// relayClient.js (CommonJS source) loads gitOps via `require('./gitOps')`.
// Vitest's vi.mock() only intercepts vite-node's ESM module graph
// (import / dynamic import, rewritten to __vite_ssr_import__); the `require`
// that vite-node injects into executed CJS modules is Node's own
// `createRequire(href)` (see node_modules/vite-node/dist/client.mjs), which
// resolves through Node's native, process-global CJS module cache and is
// therefore invisible to vi.mock. To stub gitOps for relayClient.js we
// pre-populate that shared Node require cache directly, which is the
// standard framework-independent way to mock a CommonJS module.
const require = createRequire(import.meta.url);

const gitOps = {
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  commitChanges: vi.fn(),
  pushChanges: vi.fn(),
  getRecentCommits: vi.fn(),
};

const gitOpsPath = require.resolve('./gitOps.js');
require.cache[gitOpsPath] = {
  id: gitOpsPath,
  filename: gitOpsPath,
  loaded: true,
  exports: gitOps,
};

const { handleCommand } = require('./relayClient.js');

// Two configured repos; commands address one by its id.
const repos = [
  { id: 'r1', name: 'app', path: '/repo/app' },
  { id: 'r2', name: 'docs', path: '/repo/docs' },
];

describe('handleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists repos by id and name only, without leaking paths', async () => {
    const result = await handleCommand('list-repos', {}, repos);
    expect(result).toEqual({
      repos: [
        { id: 'r1', name: 'app' },
        { id: 'r2', name: 'docs' },
      ],
    });
  });

  it('routes a command to the path of the repo named by repoId', async () => {
    gitOps.getStatus.mockResolvedValue({ staged: [], unstaged: [], untracked: [] });
    const result = await handleCommand('status', { repoId: 'r2' }, repos);
    expect(gitOps.getStatus).toHaveBeenCalledWith('/repo/docs');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('throws when repoId matches no configured repo', async () => {
    await expect(handleCommand('status', { repoId: 'gone' }, repos)).rejects.toThrow(
      'Repo not found'
    );
    expect(gitOps.getStatus).not.toHaveBeenCalled();
  });

  it('dispatches log command with the requested count', async () => {
    const commits = [{ hash: 'abc', shortHash: 'abc', subject: 'first' }];
    gitOps.getRecentCommits.mockResolvedValue(commits);
    const result = await handleCommand('log', { repoId: 'r1', count: 5 }, repos);
    expect(gitOps.getRecentCommits).toHaveBeenCalledWith('/repo/app', 5);
    expect(result).toEqual({ commits });
  });

  it('dispatches diff command with file and staged flag', async () => {
    gitOps.getDiff.mockResolvedValue('diff text');
    const result = await handleCommand('diff', { repoId: 'r1', file: 'a.txt', staged: true }, repos);
    expect(gitOps.getDiff).toHaveBeenCalledWith('/repo/app', 'a.txt', true);
    expect(result).toEqual({ diff: 'diff text' });
  });

  it('dispatches stage command with file list', async () => {
    gitOps.stageFiles.mockResolvedValue();
    const result = await handleCommand('stage', { repoId: 'r1', files: ['a.txt'] }, repos);
    expect(gitOps.stageFiles).toHaveBeenCalledWith('/repo/app', ['a.txt']);
    expect(result).toEqual({ ok: true });
  });

  it('dispatches commit command and returns commit hash', async () => {
    gitOps.commitChanges.mockResolvedValue('abc1234');
    const result = await handleCommand('commit', { repoId: 'r1', message: 'msg' }, repos);
    expect(gitOps.commitChanges).toHaveBeenCalledWith('/repo/app', 'msg');
    expect(result).toEqual({ commitHash: 'abc1234' });
  });

  it('dispatches push command', async () => {
    gitOps.pushChanges.mockResolvedValue();
    const result = await handleCommand('push', { repoId: 'r1' }, repos);
    expect(gitOps.pushChanges).toHaveBeenCalledWith('/repo/app');
    expect(result).toEqual({ ok: true });
  });

  it('throws on unknown command', async () => {
    await expect(handleCommand('bogus', { repoId: 'r1' }, repos)).rejects.toThrow(
      'Unknown command: bogus'
    );
  });
});
