const {
  getStatus,
  getDiff,
  stageFiles,
  commitChanges,
  pushChanges,
  getRecentCommits,
  getBranches,
  createBranch,
  checkoutBranch,
} = require('./gitOps');

function resolveRepoPath(repos, repoId) {
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) {
    throw new Error('Repo not found — it may have been removed on the laptop.');
  }
  return repo.path;
}

async function handleCommand(cmd, payload, repos) {
  // The phone asks for the repo list first, then tags every other command with
  // the repoId it picked. `repos` is read fresh per command, so repos added or
  // removed in the tray app take effect without re-pairing or restarting.
  if (cmd === 'list-repos') {
    return { repos: repos.map((r) => ({ id: r.id, name: r.name })) };
  }

  const repoPath = resolveRepoPath(repos, payload.repoId);
  switch (cmd) {
    case 'status':
      return getStatus(repoPath);
    case 'log':
      return { commits: await getRecentCommits(repoPath, payload.count) };
    case 'diff':
      return { diff: await getDiff(repoPath, payload.file, payload.staged) };
    case 'stage':
      await stageFiles(repoPath, payload.files);
      return { ok: true };
    case 'commit':
      return { commitHash: await commitChanges(repoPath, payload.message) };
    case 'push':
      await pushChanges(repoPath);
      return { ok: true };
    case 'branches':
      return getBranches(repoPath);
    case 'create-branch':
      await createBranch(repoPath, payload.name, payload.from);
      return getBranches(repoPath);
    case 'checkout-branch':
      await checkoutBranch(repoPath, payload.name);
      return getBranches(repoPath);
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function createRelayClient(supabaseClient, channelName, getRepos) {
  const channel = supabaseClient.channel(channelName, {
    config: { presence: { key: 'laptop' } },
  });

  channel.on('broadcast', { event: 'command' }, async ({ payload }) => {
    const { id, cmd, payload: cmdPayload } = payload;
    try {
      const data = await handleCommand(cmd, cmdPayload, getRepos());
      await channel.send({
        type: 'broadcast',
        event: 'response',
        payload: { id, ok: true, data },
      });
    } catch (error) {
      await channel.send({
        type: 'broadcast',
        event: 'response',
        payload: { id, ok: false, error: error.message },
      });
    }
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ online_at: new Date().toISOString() });
    }
  });

  return channel;
}

module.exports = { createRelayClient, handleCommand };
