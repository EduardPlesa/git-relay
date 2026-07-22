export function createRelayCommander(channel) {
  const pending = new Map();

  channel.on('broadcast', { event: 'response' }, ({ payload }) => {
    const { id, ok, data, error } = payload;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (ok) {
      entry.resolve(data);
    } else {
      entry.reject(new Error(error));
    }
  });

  function sendCommand(cmd, payload = {}, timeoutMs = 10000) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Command timed out'));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      channel.send({
        type: 'broadcast',
        event: 'command',
        payload: { id, cmd, payload },
      });
    });
  }

  return { sendCommand };
}
