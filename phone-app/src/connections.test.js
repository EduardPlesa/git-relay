import { describe, it, expect } from 'vitest';
import {
  loadConnections,
  saveConnections,
  addConnection,
  removeConnection,
  selectConnection,
  activeConnection,
  defaultLabel,
} from './connections.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

describe('loadConnections', () => {
  it('starts empty on a fresh phone', () => {
    expect(loadConnections(fakeStorage())).toEqual({ devices: [], activeId: null });
  });

  it('migrates a phone paired before multi-device support', () => {
    const storage = fakeStorage({ 'git-relay-token': 'old-token-abcd' });
    const state = loadConnections(storage);

    expect(state.devices).toHaveLength(1);
    expect(state.devices[0].token).toBe('old-token-abcd');
    expect(state.activeId).toBe(state.devices[0].id);
    // The legacy key is cleared so the migration runs exactly once.
    expect(storage.getItem('git-relay-token')).toBeNull();
    expect(loadConnections(storage).devices).toHaveLength(1);
  });

  it('falls back to the first device when activeId points at nothing', () => {
    const storage = fakeStorage({
      'git-relay-connections': JSON.stringify({
        devices: [{ id: 'a', label: 'Work', token: 't1' }],
        activeId: 'deleted-id',
      }),
    });
    expect(loadConnections(storage).activeId).toBe('a');
  });

  it('recovers from a corrupt entry instead of throwing', () => {
    const storage = fakeStorage({ 'git-relay-connections': '{not json' });
    expect(loadConnections(storage)).toEqual({ devices: [], activeId: null });
  });
});

describe('addConnection', () => {
  it('adds a device and makes it active', () => {
    const state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    expect(state.devices).toHaveLength(1);
    expect(activeConnection(state).label).toBe('Work');
  });

  it('keeps several tray apps side by side', () => {
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    state = addConnection(state, 'token-home', 'Home');

    expect(state.devices.map((d) => d.token)).toEqual(['token-work', 'token-home']);
    expect(activeConnection(state).label).toBe('Home');
  });

  it('re-selects rather than duplicating a token already saved', () => {
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    const workId = state.devices[0].id;
    state = addConnection(state, 'token-home', 'Home');
    state = addConnection(state, 'token-work', 'Work again');

    expect(state.devices).toHaveLength(2);
    expect(state.activeId).toBe(workId);
  });

  it('trims surrounding whitespace off a pasted token', () => {
    const state = addConnection({ devices: [], activeId: null }, '  token-work \n', '');
    expect(state.devices[0].token).toBe('token-work');
  });

  it('names unlabelled devices distinguishably', () => {
    let state = addConnection({ devices: [], activeId: null }, 'aaaaaaaawxyz', '');
    state = addConnection(state, 'bbbbbbbbwxyz', '');

    expect(state.devices[0].label).toBe('Laptop wxyz');
    expect(state.devices[1].label).toBe('Laptop wxyz (2)');
  });
});

describe('removeConnection', () => {
  it('moves the active slot to a survivor', () => {
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    state = addConnection(state, 'token-home', 'Home');
    state = removeConnection(state, state.activeId);

    expect(state.devices).toHaveLength(1);
    expect(activeConnection(state).label).toBe('Work');
  });

  it('leaves no active device when the last one goes', () => {
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    state = removeConnection(state, state.activeId);

    expect(state).toEqual({ devices: [], activeId: null });
    expect(activeConnection(state)).toBeNull();
  });
});

describe('selectConnection', () => {
  it('switches the active device', () => {
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    const workId = state.devices[0].id;
    state = addConnection(state, 'token-home', 'Home');

    expect(activeConnection(selectConnection(state, workId)).token).toBe('token-work');
  });

  it('ignores an unknown id', () => {
    const state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    expect(selectConnection(state, 'nope')).toBe(state);
  });
});

describe('round-tripping through storage', () => {
  it('restores the same devices and active slot', () => {
    const storage = fakeStorage();
    let state = addConnection({ devices: [], activeId: null }, 'token-work', 'Work');
    state = addConnection(state, 'token-home', 'Home');
    saveConnections(storage, state);

    expect(loadConnections(storage)).toEqual(state);
  });
});

describe('defaultLabel', () => {
  it('uses the token tail so two laptops read differently', () => {
    expect(defaultLabel('xxxxxxxx1234')).toBe('Laptop 1234');
  });
});
