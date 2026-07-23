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
      // Real Realtime fires a presence 'sync' event on every member of the
      // channel whenever anyone's presence changes, which is how a phone
      // notices the laptop just joined. Nothing exercised this before now —
      // multiDevice/connections tests dispatch broadcasts directly and never
      // registered a presence handler — so this is purely additive.
      track: () => {
        for (const other of channels.get(name)) {
          for (const h of other._handlers) {
            if (h.type === 'presence' && h.event === 'sync') h.handler();
          }
        }
        return Promise.resolve('ok');
      },
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
    // Notify members already on the channel that someone new just joined —
    // real Realtime syncs presence to everyone on join, not only on track().
    for (const other of channels.get(name)) {
      if (other === member) continue;
      for (const h of other._handlers) {
        if (h.type === 'presence' && h.event === 'sync') h.handler();
      }
    }
    return member;
  }

  // Mirrors supabase-js's removeChannel: drops the member and lets the rest
  // of the channel see it leave, same as track() lets them see it arrive.
  function removeChannel(member) {
    const members = channels.get(member.name);
    if (!members) return;
    members.delete(member);
    for (const other of members) {
      for (const h of other._handlers) {
        if (h.type === 'presence' && h.event === 'sync') h.handler();
      }
    }
  }

  return { channel, removeChannel };
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

/**
 * A laptop agent with real in-memory state, for component tests that drive
 * more than a single round trip. Mirrors relayClient.js's own dispatch table
 * (status/log/branches/stage/commit/push/pull/discard/create-branch/
 * checkout-branch/delete-branch/diff) against plain objects instead of a real
 * git repo, so a test can assert on before/after state without touching disk.
 *
 * `repos` is `[{ id, name, status, branches, commits }]` — `status` matches
 * gitOps.getStatus()'s shape, `branches` matches gitOps.getBranches()'s.
 *
 * `beforeRespond(cmd, payload)` is an optional hook to hold up a response —
 * return a promise from it and the test controls when (or whether) it
 * resolves, which is how the busy-guard and stale-repo-switch tests simulate
 * a slow network without a real timer.
 */
export function attachStatefulFakeLaptop(hub, token, repos, { beforeRespond } = {}) {
  const seen = [];
  const channel = hub.channel(token, { config: { presence: { key: 'laptop' } } });

  function findRepo(repoId) {
    return repos.find((r) => r.id === repoId);
  }

  async function handle(cmd, payload) {
    if (cmd === 'list-repos') {
      return { repos: repos.map((r) => ({ id: r.id, name: r.name })) };
    }

    const repo = findRepo(payload.repoId);
    if (!repo) {
      throw new Error('Repo not found — it may have been removed on the laptop.');
    }

    switch (cmd) {
      case 'status':
        return { ...repo.status };
      case 'log':
        return { commits: repo.commits.slice(0, payload.count ?? 20) };
      case 'branches':
        return { ...repo.branches };
      case 'diff':
        return { diff: `--- a/${payload.file}\n+++ b/${payload.file}\n` };
      case 'stage': {
        const files = payload.files ?? [];
        repo.status.staged = [...new Set([...repo.status.staged, ...files])];
        repo.status.unstaged = repo.status.unstaged.filter((f) => !files.includes(f));
        repo.status.untracked = repo.status.untracked.filter((f) => !files.includes(f));
        return { ok: true };
      }
      case 'commit': {
        const hash = `commit${repo.commits.length + 1}`;
        repo.commits = [
          {
            hash,
            shortHash: hash,
            subject: payload.message,
            author: 'Test User',
            date: new Date().toISOString(),
          },
          ...repo.commits,
        ];
        repo.status.staged = [];
        repo.status.ahead = (repo.status.ahead ?? 0) + 1;
        return { commitHash: hash };
      }
      case 'push':
        repo.status.ahead = 0;
        return { ok: true };
      case 'pull':
        repo.status.behind = 0;
        return { ok: true };
      case 'discard':
        repo.status.unstaged = repo.status.unstaged.filter((f) => f !== payload.file);
        repo.status.untracked = repo.status.untracked.filter((f) => f !== payload.file);
        return { ok: true };
      case 'create-branch':
        repo.branches.all = [...repo.branches.all, payload.name];
        repo.branches.current = payload.name;
        return { ...repo.branches };
      case 'checkout-branch':
        if (!repo.branches.all.includes(payload.name)) {
          throw new Error(`pathspec '${payload.name}' did not match any file(s) known to git`);
        }
        repo.branches.current = payload.name;
        return { ...repo.branches };
      case 'delete-branch':
        if (payload.name === repo.branches.current) {
          throw new Error(`error: Cannot delete branch '${payload.name}' checked out`);
        }
        repo.branches.all = repo.branches.all.filter((n) => n !== payload.name);
        return { ...repo.branches };
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  channel.on('broadcast', { event: 'command' }, async ({ payload }) => {
    const { id, cmd, payload: cmdPayload = {} } = payload;
    seen.push({ cmd, payload: cmdPayload });
    if (beforeRespond) {
      await beforeRespond(cmd, cmdPayload);
    }
    try {
      const data = await handle(cmd, cmdPayload);
      await channel.send({ type: 'broadcast', event: 'response', payload: { id, ok: true, data } });
    } catch (error) {
      await channel.send({
        type: 'broadcast',
        event: 'response',
        payload: { id, ok: false, error: error.message },
      });
    }
  });

  channel.subscribe();
  return { channel, seen, repos };
}
