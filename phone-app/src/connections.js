/**
 * Saved laptop connections.
 *
 * A pairing token doubles as the Realtime channel name, so one token means one
 * tray app. Holding a list of them lets a single phone drive several laptops —
 * work and home, or a teammate's machine — switching without re-pairing.
 */

const STORAGE_KEY = 'git-relay-connections';
const LEGACY_KEY = 'git-relay-token';

const EMPTY = { devices: [], activeId: null };

function newId() {
  return crypto.randomUUID();
}

/** Short, recognisable stand-in when the user doesn't name a device. */
export function defaultLabel(token, existing = []) {
  const suffix = token.slice(-4);
  const base = `Laptop ${suffix}`;
  if (!existing.some((d) => d.label === base)) return base;
  let n = 2;
  while (existing.some((d) => d.label === `${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function loadConnections(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
      const activeId = devices.some((d) => d.id === parsed.activeId)
        ? parsed.activeId
        : (devices[0]?.id ?? null);
      return { devices, activeId };
    } catch {
      return EMPTY; // corrupt entry — start clean rather than trapping the user
    }
  }

  // Upgrade a phone paired before multi-device support existed.
  const legacy = storage.getItem(LEGACY_KEY);
  if (legacy) {
    const device = { id: newId(), label: defaultLabel(legacy), token: legacy };
    const state = { devices: [device], activeId: device.id };
    saveConnections(storage, state);
    storage.removeItem(LEGACY_KEY);
    return state;
  }

  return EMPTY;
}

export function saveConnections(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** Adds a device, or re-selects the existing one if the token is already saved. */
export function addConnection(state, token, label) {
  const trimmed = token.trim();
  const existing = state.devices.find((d) => d.token === trimmed);
  if (existing) {
    return { devices: state.devices, activeId: existing.id };
  }
  const device = {
    id: newId(),
    label: (label || '').trim() || defaultLabel(trimmed, state.devices),
    token: trimmed,
  };
  return { devices: [...state.devices, device], activeId: device.id };
}

export function removeConnection(state, id) {
  const devices = state.devices.filter((d) => d.id !== id);
  const activeId = state.activeId === id ? (devices[0]?.id ?? null) : state.activeId;
  return { devices, activeId };
}

export function selectConnection(state, id) {
  if (!state.devices.some((d) => d.id === id)) return state;
  return { devices: state.devices, activeId: id };
}

export function activeConnection(state) {
  return state.devices.find((d) => d.id === state.activeId) ?? null;
}
