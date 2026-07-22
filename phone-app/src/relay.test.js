import { describe, it, expect, vi } from 'vitest';
import { createRelayCommander } from './relay.js';

function createFakeChannel() {
  let responseHandler = null;
  return {
    on: vi.fn((type, filter, handler) => {
      if (filter.event === 'response') {
        responseHandler = handler;
      }
    }),
    send: vi.fn(),
    emitResponse(payload) {
      responseHandler({ payload });
    },
  };
}

describe('createRelayCommander', () => {
  it('resolves when a matching response arrives', async () => {
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('status', {});
    const sentPayload = channel.send.mock.calls[0][0].payload;
    channel.emitResponse({ id: sentPayload.id, ok: true, data: { staged: [] } });

    await expect(promise).resolves.toEqual({ staged: [] });
  });

  it('rejects when response has ok: false', async () => {
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('push', {});
    const sentPayload = channel.send.mock.calls[0][0].payload;
    channel.emitResponse({ id: sentPayload.id, ok: false, error: 'push failed' });

    await expect(promise).rejects.toThrow('push failed');
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('status', {}, 50);
    vi.advanceTimersByTime(60);

    await expect(promise).rejects.toThrow('Command timed out');
    vi.useRealTimers();
  });
});
