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
};

const gitOpsPath = require.resolve('./gitOps.js');
require.cache[gitOpsPath] = {
  id: gitOpsPath,
  filename: gitOpsPath,
  loaded: true,
  exports: gitOps,
};

const { handleCommand } = require('./relayClient.js');

describe('handleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches status command to getStatus', async () => {
    gitOps.getStatus.mockResolvedValue({ staged: [], unstaged: [], untracked: [] });
    const result = await handleCommand('status', {}, '/repo');
    expect(gitOps.getStatus).toHaveBeenCalledWith('/repo');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('dispatches diff command with file and staged flag', async () => {
    gitOps.getDiff.mockResolvedValue('diff text');
    const result = await handleCommand('diff', { file: 'a.txt', staged: true }, '/repo');
    expect(gitOps.getDiff).toHaveBeenCalledWith('/repo', 'a.txt', true);
    expect(result).toEqual({ diff: 'diff text' });
  });

  it('dispatches stage command with file list', async () => {
    gitOps.stageFiles.mockResolvedValue();
    const result = await handleCommand('stage', { files: ['a.txt'] }, '/repo');
    expect(gitOps.stageFiles).toHaveBeenCalledWith('/repo', ['a.txt']);
    expect(result).toEqual({ ok: true });
  });

  it('dispatches commit command and returns commit hash', async () => {
    gitOps.commitChanges.mockResolvedValue('abc1234');
    const result = await handleCommand('commit', { message: 'msg' }, '/repo');
    expect(gitOps.commitChanges).toHaveBeenCalledWith('/repo', 'msg');
    expect(result).toEqual({ commitHash: 'abc1234' });
  });

  it('dispatches push command', async () => {
    gitOps.pushChanges.mockResolvedValue();
    const result = await handleCommand('push', {}, '/repo');
    expect(gitOps.pushChanges).toHaveBeenCalledWith('/repo');
    expect(result).toEqual({ ok: true });
  });

  it('throws on unknown command', async () => {
    await expect(handleCommand('bogus', {}, '/repo')).rejects.toThrow('Unknown command: bogus');
  });
});
