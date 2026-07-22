const { getStatus, getDiff, stageFiles, commitChanges, pushChanges } = require('./gitOps');

async function handleCommand(cmd, payload, repoPath) {
  switch (cmd) {
    case 'status':
      return getStatus(repoPath);
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
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function createRelayClient(supabaseClient, channelName, repoPath) {
  const channel = supabaseClient.channel(channelName, {
    config: { presence: { key: 'laptop' } },
  });

  channel.on('broadcast', { event: 'command' }, async ({ payload }) => {
    const { id, cmd, payload: cmdPayload } = payload;
    try {
      const data = await handleCommand(cmd, cmdPayload, repoPath);
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
