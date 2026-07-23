/**
 * In-memory stand-in for Supabase Realtime, for tests.
 *
 * Models the two properties the relay actually depends on:
 *   1. A channel name is the isolation boundary — a broadcast reaches only
 *      subscribers that joined under the same name.
 *   2. Broadcasts are not echoed to their own sender (Realtime's `self: false`
 *      default), but every *other* member of the channel receives them.
 */
export function createFakeHub() {
  const channels = new Map(); // name -> Set of member channels

  function channel(name, config = {}) {
    const handlers = [];
    const member = {
      name,
      config,
      on(type, filter, handler) {
        handlers.push({ type, event: filter.event, handler });
        return member;
      },
      send({ event, payload }) {
        for (const other of channels.get(name)) {
          if (other === member) continue; // no self-echo
          for (const h of other._handlers) {
            if (h.event === event) h.handler({ payload });
          }
        }
        return Promise.resolve('ok');
      },
      subscribe(cb) {
        if (cb) cb('SUBSCRIBED');
        return member;
      },
      track: () => Promise.resolve('ok'),
      presenceState: () => {
        const state = {};
        for (const other of channels.get(name)) {
          const key = other.config?.config?.presence?.key;
          if (!key) continue;
          state[key] = state[key] || [];
          state[key].push({});
        }
        return state;
      },
      _handlers: handlers,
    };

    if (!channels.has(name)) channels.set(name, new Set());
    channels.get(name).add(member);
    return member;
  }

  return { channel };
}

/** A laptop agent: answers `command` broadcasts for one repo. */
export function attachFakeLaptop(hub, token, repoName) {
  const seen = [];
  const channel = hub.channel(token, { config: { presence: { key: 'laptop' } } });

  channel.on('broadcast', { event: 'command' }, ({ payload }) => {
    const { id, cmd } = payload;
    seen.push(cmd);
    channel.send({
      type: 'broadcast',
      event: 'response',
      payload: { id, ok: true, data: { repo: repoName, staged: [], unstaged: [], untracked: [] } },
    });
  });

  channel.subscribe();
  return { channel, seen };
}

/**
 * A laptop agent holding several repos, mirroring the real handler: it answers
 * `list-repos` with id+name pairs and scopes every other command by the
 * `repoId` the phone sends back.
 */
export function attachMultiRepoLaptop(hub, token, repos) {
  const seen = [];
  const channel = hub.channel(token, { config: { presence: { key: 'laptop' } } });

  channel.on('broadcast', { event: 'command' }, ({ payload }) => {
    const { id, cmd, payload: cmdPayload = {} } = payload;
    let response;
    if (cmd === 'list-repos') {
      response = { ok: true, data: { repos: repos.map((r) => ({ id: r.id, name: r.name })) } };
    } else {
      const repo = repos.find((r) => r.id === cmdPayload.repoId);
      if (!repo) {
        response = { ok: false, error: 'Repo not found' };
      } else {
        seen.push({ cmd, repo: repo.name });
        response = { ok: true, data: { repo: repo.name, staged: [], unstaged: [], untracked: [] } };
      }
    }
    channel.send({ type: 'broadcast', event: 'response', payload: { id, ...response } });
  });

  channel.subscribe();
  return { channel, seen };
}
