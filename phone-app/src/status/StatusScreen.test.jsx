// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusScreen from './StatusScreen.jsx';
import { createFakeHub, attachStatefulFakeLaptop } from '../fakeRelay.js';

// StatusScreen imports a real createSupabaseClient(); swapping it for a fake
// hub lets every test drive the exact same broadcast/presence code paths the
// component uses against a real Supabase Realtime channel, without a network.
let currentHub;
vi.mock('../supabaseClient.js', () => ({
  createSupabaseClient: () => ({
    channel: (...args) => currentHub.channel(...args),
    removeChannel: (member) => currentHub.removeChannel(member),
  }),
}));

beforeEach(() => {
  currentHub = createFakeHub();
});

// Vitest doesn't set `globals: true`, so @testing-library/react's own
// auto-cleanup (which hooks a global `afterEach`) never registers — without
// this, each test's rendered DOM piles up in the same jsdom document.
afterEach(() => {
  cleanup();
});

function makeRepo(overrides = {}) {
  return {
    id: 'r1',
    name: 'demo',
    status: {
      staged: [],
      unstaged: ['a.txt'],
      untracked: [],
      branch: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
    },
    branches: { current: 'main', all: ['main', 'feature'] },
    commits: [
      {
        hash: 'aaa1111',
        shortHash: 'aaa1111',
        subject: 'init',
        author: 'Test User',
        date: '2024-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('StatusScreen', () => {
  it('shows offline, then the repo picker once the laptop connects', async () => {
    render(<StatusScreen token="tok" />);
    expect(screen.getByText('Offline')).toBeTruthy();

    act(() => {
      attachStatefulFakeLaptop(currentHub, 'tok', [makeRepo()]);
    });

    expect(await screen.findByText('Online')).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'demo' })).toBeTruthy();
  });

  it('switches branch via the picker', async () => {
    const user = userEvent.setup();
    attachStatefulFakeLaptop(currentHub, 'tok', [makeRepo()]);
    render(<StatusScreen token="tok" />);

    const branchSelect = await screen.findByDisplayValue('main');
    await user.selectOptions(branchSelect, 'feature');

    await waitFor(() => {
      expect(branchSelect.value).toBe('feature');
    });
  });

  it('discards an unstaged file after confirming', async () => {
    const user = userEvent.setup();
    attachStatefulFakeLaptop(currentHub, 'tok', [makeRepo()]);
    render(<StatusScreen token="tok" />);

    await screen.findByText('a.txt');
    await user.click(screen.getAllByRole('button', { name: 'Discard' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Discard' })[1]);

    await waitFor(() => {
      expect(screen.queryByText('a.txt')).toBeNull();
    });
    expect(screen.getByText('Nothing to stage.')).toBeTruthy();
  });

  it('deletes a non-current branch after confirming', async () => {
    const user = userEvent.setup();
    attachStatefulFakeLaptop(currentHub, 'tok', [makeRepo()]);
    render(<StatusScreen token="tok" />);

    await screen.findByDisplayValue('main');
    await user.click(screen.getByText('Manage branches…'));
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => {
      expect(screen.queryByText('feature')).toBeNull();
    });
  });

  it('disables Push (and every other action) while a push is in flight, and re-enables once it resolves', async () => {
    const user = userEvent.setup();
    let resolvePush;
    attachStatefulFakeLaptop(currentHub, 'tok', [makeRepo()], {
      beforeRespond: (cmd) =>
        cmd === 'push'
          ? new Promise((resolve) => {
              resolvePush = resolve;
            })
          : undefined,
    });
    render(<StatusScreen token="tok" />);

    const pushButton = await screen.findByRole('button', { name: 'Push' });
    await user.click(pushButton);

    await waitFor(() => {
      expect(pushButton.disabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Pull' }).disabled).toBe(true);

    resolvePush();

    await waitFor(() => {
      expect(pushButton.disabled).toBe(false);
    });
  });

  it('ignores a stale status response after switching to a different repo', async () => {
    const user = userEvent.setup();
    let resolveSlowStatus;
    let staleStatusRequested = false;
    const repoA = makeRepo({
      id: 'rA',
      name: 'alpha',
      status: { staged: [], unstaged: ['a.txt'], untracked: [], branch: 'main', tracking: null, ahead: 0, behind: 0 },
    });
    const repoB = makeRepo({
      id: 'rB',
      name: 'beta',
      status: { staged: [], unstaged: ['b.txt'], untracked: [], branch: 'main', tracking: null, ahead: 0, behind: 0 },
    });

    attachStatefulFakeLaptop(currentHub, 'tok', [repoA, repoB], {
      beforeRespond: (cmd, payload) => {
        // Hold up only repo A's very first status request — the one fired
        // as soon as the phone loads the repo list and defaults to repo A.
        if (cmd === 'status' && payload.repoId === 'rA' && !staleStatusRequested) {
          staleStatusRequested = true;
          return new Promise((resolve) => {
            resolveSlowStatus = resolve;
          });
        }
        return undefined;
      },
    });

    render(<StatusScreen token="tok" />);

    // Repo A is selected by default and its status request is now stuck.
    // Switch to repo B before it resolves.
    const repoSelect = await screen.findByDisplayValue('alpha');
    await user.selectOptions(repoSelect, 'rB');

    await screen.findByText('b.txt');

    // Now let repo A's slow response land. It must not clobber the screen,
    // which is showing repo B, with repo A's file.
    resolveSlowStatus();
    await waitFor(() => {
      expect(screen.getByText('b.txt')).toBeTruthy();
    });
    expect(screen.queryByText('a.txt')).toBeNull();
  });
});
