import { describe, it, expect } from 'vitest';
import { createRelayCommander } from './relay.js';
import { createFakeHub, attachFakeLaptop } from './fakeRelay.js';

describe('two phones holding the same token', () => {
  it('both reach the same laptop and see the same repo', async () => {
    const hub = createFakeHub();
    const laptop = attachFakeLaptop(hub, 'token-alice', 'alice-repo');

    const phoneA = createRelayCommander(hub.channel('token-alice', {}));
    const phoneB = createRelayCommander(hub.channel('token-alice', {}));

    const [a, b] = await Promise.all([
      phoneA.sendCommand('status'),
      phoneB.sendCommand('status'),
    ]);

    expect(a.repo).toBe('alice-repo');
    expect(b.repo).toBe('alice-repo');
    expect(laptop.seen).toEqual(['status', 'status']);
  });

  it("a phone ignores the response to another phone's command", async () => {
    const hub = createFakeHub();
    attachFakeLaptop(hub, 'token-alice', 'alice-repo');

    const channelB = hub.channel('token-alice', {});
    const phoneB = createRelayCommander(channelB);
    const phoneA = createRelayCommander(hub.channel('token-alice', {}));

    // Phone B is listening on the same channel while A runs a command. Its
    // pending map has no entry for A's id, so the stray response is dropped
    // rather than resolving one of B's own commands.
    await expect(phoneA.sendCommand('status')).resolves.toMatchObject({ repo: 'alice-repo' });

    const pendingB = phoneB.sendCommand('status', {}, 50);
    await expect(pendingB).resolves.toMatchObject({ repo: 'alice-repo' });
  });
});

describe('separate tray apps on separate tokens', () => {
  it('routes each phone only to its own laptop', async () => {
    const hub = createFakeHub();
    const alice = attachFakeLaptop(hub, 'token-alice', 'alice-repo');
    const bob = attachFakeLaptop(hub, 'token-bob', 'bob-repo');

    const phoneA = createRelayCommander(hub.channel('token-alice', {}));
    const phoneB = createRelayCommander(hub.channel('token-bob', {}));

    await expect(phoneA.sendCommand('status')).resolves.toMatchObject({ repo: 'alice-repo' });
    await expect(phoneB.sendCommand('status')).resolves.toMatchObject({ repo: 'bob-repo' });

    expect(alice.seen).toEqual(['status']);
    expect(bob.seen).toEqual(['status']);
  });

  it('never leaks a command across tokens', async () => {
    const hub = createFakeHub();
    const alice = attachFakeLaptop(hub, 'token-alice', 'alice-repo');
    const bob = attachFakeLaptop(hub, 'token-bob', 'bob-repo');

    const phoneA = createRelayCommander(hub.channel('token-alice', {}));
    await phoneA.sendCommand('commit', { message: 'from alice' });

    expect(alice.seen).toEqual(['commit']);
    expect(bob.seen).toEqual([]);
  });

  it('times out against a token with no laptop behind it', async () => {
    const hub = createFakeHub();
    attachFakeLaptop(hub, 'token-alice', 'alice-repo');

    const orphan = createRelayCommander(hub.channel('token-nobody', {}));
    await expect(orphan.sendCommand('status', {}, 20)).rejects.toThrow('Command timed out');
  });
});

describe('one phone driving several tray apps', () => {
  it('keeps each connection on its own channel', async () => {
    const hub = createFakeHub();
    attachFakeLaptop(hub, 'token-work', 'work-repo');
    attachFakeLaptop(hub, 'token-home', 'home-repo');

    // The same device, switching between two saved connections.
    const work = createRelayCommander(hub.channel('token-work', {}));
    const home = createRelayCommander(hub.channel('token-home', {}));

    await expect(work.sendCommand('status')).resolves.toMatchObject({ repo: 'work-repo' });
    await expect(home.sendCommand('status')).resolves.toMatchObject({ repo: 'home-repo' });
  });
});
