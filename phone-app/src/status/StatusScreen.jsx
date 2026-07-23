import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../supabaseClient.js';
import { createRelayCommander } from '../relay.js';

const EMPTY_STATUS = { staged: [], unstaged: [], untracked: [] };
const EMPTY_BRANCHES = { current: null, all: [] };

export default function StatusScreen({
  token,
  devices = [],
  activeId = null,
  onSelectDevice,
  onAddDevice,
  onRemoveDevice,
}) {
  const [online, setOnline] = useState(false);
  const [repos, setRepos] = useState([]);
  const [repoId, setRepoId] = useState(null);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [commits, setCommits] = useState([]);
  const [branches, setBranches] = useState(EMPTY_BRANCHES);
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [diffText, setDiffText] = useState('');
  const [diffFile, setDiffFile] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [errorText, setErrorText] = useState('');
  const [noticeText, setNoticeText] = useState('');
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [showManageBranches, setShowManageBranches] = useState(false);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  const [busy, setBusy] = useState(false);
  const commanderRef = useRef(null);
  const channelRef = useRef(null);
  const phoneIdRef = useRef(crypto.randomUUID());
  const repoIdRef = useRef(repoId);

  useEffect(() => {
    repoIdRef.current = repoId;
  }, [repoId]);

  // A response arriving after the user has since switched repos would
  // otherwise overwrite the newly-selected repo's state with the old one's.
  function isStaleRepo(requestRepoId) {
    return requestRepoId !== repoIdRef.current;
  }

  // Wraps a user-triggered action so its button is disabled for the duration —
  // without this, a slow round-trip plus an impatient second tap could fire
  // the same commit/push/discard/etc. twice.
  async function runAction(fn) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase.channel(token, {
      // A per-phone key: presence entries are keyed, so two phones sharing a
      // token under a fixed 'phone' key would overwrite each other and the
      // laptop would only ever see one of them connected.
      config: { presence: { key: `phone-${phoneIdRef.current}` } },
    });
    channelRef.current = channel;
    commanderRef.current = createRelayCommander(channel);

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      setOnline(Boolean(state.laptop && state.laptop.length > 0));
    });

    channel.subscribe(async (subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [token]);

  // Every git command is scoped to a repo, so send the selected repoId along.
  function run(cmd, payload = {}, timeoutMs) {
    return commanderRef.current.sendCommand(cmd, { ...payload, repoId }, timeoutMs);
  }

  async function loadRepos() {
    setErrorText('');
    try {
      const result = await commanderRef.current.sendCommand('list-repos');
      setRepos(result.repos);
      // Keep the current repo if it still exists; otherwise fall back to the
      // first one the laptop offers (or nothing, if it has none configured).
      setRepoId((current) =>
        result.repos.some((r) => r.id === current) ? current : (result.repos[0]?.id ?? null)
      );
    } catch (error) {
      setErrorText(error.message);
    }
  }

  // Fetch the repo list as soon as the laptop is reachable.
  useEffect(() => {
    if (online) {
      loadRepos();
    } else {
      setRepos([]);
      setRepoId(null);
    }
  }, [online]);

  async function refreshStatus() {
    const requestRepoId = repoId;
    setErrorText('');
    try {
      const result = await run('status');
      if (isStaleRepo(requestRepoId)) return;
      setStatus(result);
      setSelectedFiles([]);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function loadCommits() {
    const requestRepoId = repoId;
    try {
      const result = await run('log', { count: 20 });
      if (isStaleRepo(requestRepoId)) return;
      setCommits(result.commits);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function loadBranches() {
    const requestRepoId = repoId;
    try {
      const result = await run('branches');
      if (isStaleRepo(requestRepoId)) return;
      setBranches(result);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  // When the chosen repo changes (or is first set), pull its status and history.
  // Switching repos also clears the previous repo's diff and staged selection.
  useEffect(() => {
    if (online && repoId) {
      setDiffFile(null);
      setDiffText('');
      setStatus(EMPTY_STATUS);
      setCommits([]);
      setBranches(EMPTY_BRANCHES);
      setShowNewBranch(false);
      setShowManageBranches(false);
      setConfirmDeleteBranch(null);
      setConfirmDiscard(null);
      refreshStatus();
      loadCommits();
      loadBranches();
    }
  }, [online, repoId]);

  // Both branch and status/log change together, so refresh all three after
  // creating or switching a branch rather than leaving stale data on screen.
  async function switchBranch(name) {
    const requestRepoId = repoId;
    setErrorText('');
    try {
      const result = await run('checkout-branch', { name });
      if (isStaleRepo(requestRepoId)) return;
      setBranches(result);
      await Promise.all([refreshStatus(), loadCommits()]);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function createNewBranch(event) {
    event.preventDefault();
    const name = newBranchName.trim();
    if (!name) return;
    const requestRepoId = repoId;
    setErrorText('');
    try {
      const result = await run('create-branch', { name });
      setNewBranchName('');
      setShowNewBranch(false);
      if (isStaleRepo(requestRepoId)) return;
      setBranches(result);
      await Promise.all([refreshStatus(), loadCommits()]);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function deleteBranchByName(name) {
    const requestRepoId = repoId;
    setErrorText('');
    try {
      const result = await run('delete-branch', { name });
      setConfirmDeleteBranch(null);
      if (isStaleRepo(requestRepoId)) return;
      setBranches(result);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function discardChange(file, tracked) {
    const requestRepoId = repoId;
    setErrorText('');
    try {
      await run('discard', { file, tracked });
      setConfirmDiscard(null);
      if (isStaleRepo(requestRepoId)) return;
      await refreshStatus();
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  async function viewDiff(file, staged) {
    const requestRepoId = repoId;
    setErrorText('');
    try {
      const result = await run('diff', { file, staged });
      if (isStaleRepo(requestRepoId)) return;
      setDiffFile(file);
      setDiffText(result.diff);
    } catch (error) {
      if (isStaleRepo(requestRepoId)) return;
      setErrorText(error.message);
    }
  }

  function closeDiff() {
    setDiffFile(null);
    setDiffText('');
  }

  function toggleFile(file) {
    setSelectedFiles((current) =>
      current.includes(file) ? current.filter((f) => f !== file) : [...current, file]
    );
  }

  async function stageSelected() {
    setErrorText('');
    try {
      await run('stage', { files: selectedFiles });
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function commit() {
    setErrorText('');
    setNoticeText('');
    try {
      const result = await run('commit', { message: commitMessage });
      setCommitMessage('');
      setNoticeText(`Committed ${result.commitHash.slice(0, 7)}.`);
      await Promise.all([refreshStatus(), loadCommits()]);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function push() {
    setErrorText('');
    setNoticeText('Pushing…');
    try {
      await run('push', {}, 30000);
      setNoticeText('Pushed to remote.');
    } catch (error) {
      setNoticeText('');
      setErrorText(error.message);
    }
  }

  async function pull() {
    setErrorText('');
    setNoticeText('Pulling…');
    try {
      await run('pull', {}, 30000);
      setNoticeText('Pulled from remote.');
      await Promise.all([refreshStatus(), loadCommits()]);
    } catch (error) {
      setNoticeText('');
      setErrorText(error.message);
    }
  }

  const changedFiles = [...status.unstaged, ...status.untracked];
  const activeLabel = devices.find((d) => d.id === activeId)?.label ?? 'this laptop';
  const hasRepo = Boolean(repoId);
  const otherBranches = branches.all.filter((name) => name !== branches.current);

  function trackingLabel() {
    if (!status.tracking) return 'No upstream branch yet';
    const parts = [];
    if (status.ahead) parts.push(`${status.ahead} ahead`);
    if (status.behind) parts.push(`${status.behind} behind`);
    if (parts.length === 0) return `Up to date with ${status.tracking}`;
    return `${parts.join(' · ')} of ${status.tracking}`;
  }

  return (
    <div className="app">
      <div className="bar">
        <h1>Git Relay</h1>
        <span className={online ? 'dot is-online' : 'dot'}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="devices">
        <select
          value={activeId ?? ''}
          onChange={(event) => {
            if (event.target.value === '__add') {
              onAddDevice();
            } else {
              onSelectDevice(event.target.value);
            }
          }}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
          <option value="__add">+ Add a laptop…</option>
        </select>
        <button className="link" onClick={() => setConfirmUnpair(true)}>
          Unpair
        </button>
      </div>

      {confirmUnpair && (
        <p className="msg is-warn">
          Forget {activeLabel}? The tray app keeps running; you can pair again with the same
          token.{' '}
          <button
            className="link"
            onClick={() => {
              setConfirmUnpair(false);
              onRemoveDevice(activeId);
            }}
          >
            Forget
          </button>{' '}
          <button className="link" onClick={() => setConfirmUnpair(false)}>
            Keep
          </button>
        </p>
      )}

      {!online && (
        <p className="msg is-warn">
          Start the Git Relay tray app on your laptop — every action is disabled until it connects.
        </p>
      )}
      {errorText && <p className="msg is-error">{errorText}</p>}
      {noticeText && <p className="msg is-ok">{noticeText}</p>}

      {online && (
        <>
          <h2>Repository</h2>
          {repos.length === 0 ? (
            <p className="empty">
              No repos on this laptop yet. Open the tray app → Pairing &amp; Settings and add one.
            </p>
          ) : (
            <select
              className="repo-select"
              value={repoId ?? ''}
              onChange={(event) => setRepoId(event.target.value)}
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {online && hasRepo && (
        <>
          <h2>Branch</h2>
          {branches.all.length === 0 ? (
            <p className="empty">Loading branches…</p>
          ) : (
            <select
              className="repo-select"
              value={branches.current ?? ''}
              disabled={busy}
              onChange={(event) => runAction(() => switchBranch(event.target.value))}
            >
              {branches.all.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {branches.current && <p className="hint">{trackingLabel()}</p>}

          {showNewBranch && (
            <form
              className="branch-form"
              onSubmit={(event) => runAction(() => createNewBranch(event))}
            >
              <input
                type="text"
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
                placeholder="new-branch-name"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
              />
              <div className="row">
                <button type="submit" disabled={!newBranchName.trim() || busy}>
                  Create
                </button>
                <button type="button" className="link" onClick={() => setShowNewBranch(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="row">
            {!showNewBranch && (
              <button className="link" onClick={() => setShowNewBranch(true)}>
                New branch…
              </button>
            )}
            <button className="link" onClick={() => setShowManageBranches((v) => !v)}>
              {showManageBranches ? 'Done' : 'Manage branches…'}
            </button>
          </div>

          {showManageBranches &&
            (otherBranches.length === 0 ? (
              <p className="empty">No other branches to manage.</p>
            ) : (
              <ul className="files">
                {otherBranches.map((name) => (
                  <li key={name}>
                    <span className="path">{name}</span>
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() => setConfirmDeleteBranch(name)}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {confirmDeleteBranch && (
            <p className="msg is-warn">
              Delete branch <code className="path">{confirmDeleteBranch}</code>? This can't be
              undone from the phone.{' '}
              <button
                className="link"
                disabled={busy}
                onClick={() => runAction(() => deleteBranchByName(confirmDeleteBranch))}
              >
                Delete
              </button>{' '}
              <button className="link" onClick={() => setConfirmDeleteBranch(null)}>
                Keep
              </button>
            </p>
          )}
        </>
      )}

      <h2>Unstaged &amp; untracked</h2>
      {changedFiles.length === 0 ? (
        <p className="empty">Nothing to stage.</p>
      ) : (
        <ul className="files">
          {changedFiles.map((file) => (
            <li key={file}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedFiles.includes(file)}
                  onChange={() => toggleFile(file)}
                />
                <span className="path">{file}</span>
              </label>
              <button className="link" onClick={() => viewDiff(file, false)}>
                Diff
              </button>
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  setConfirmDiscard({ file, tracked: status.unstaged.includes(file) })
                }
              >
                Discard
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmDiscard && (
        <p className="msg is-warn">
          Discard changes to <code className="path">{confirmDiscard.file}</code>? This can't be
          undone.{' '}
          <button
            className="link"
            disabled={busy}
            onClick={() => runAction(() => discardChange(confirmDiscard.file, confirmDiscard.tracked))}
          >
            Discard
          </button>{' '}
          <button className="link" onClick={() => setConfirmDiscard(null)}>
            Keep
          </button>
        </p>
      )}

      <button
        className="primary wide"
        onClick={() => runAction(stageSelected)}
        disabled={!online || !hasRepo || selectedFiles.length === 0 || busy}
      >
        Stage {selectedFiles.length > 0 ? `${selectedFiles.length} selected` : 'selected'}
      </button>

      <h2>Staged</h2>
      {status.staged.length === 0 ? (
        <p className="empty">Stage a file before committing.</p>
      ) : (
        <ul className="files">
          {status.staged.map((file) => (
            <li key={file}>
              <span className="path">{file}</span>
              <button className="link" onClick={() => viewDiff(file, true)}>
                Diff
              </button>
            </li>
          ))}
        </ul>
      )}

      {diffFile && (
        <section className="diff">
          <header>
            <span className="path">{diffFile}</span>
            <button className="link" onClick={closeDiff}>
              Close
            </button>
          </header>
          <pre>{diffText}</pre>
        </section>
      )}

      <h2>Commit</h2>
      <textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="Commit message"
      />
      <button
        className="primary wide"
        onClick={() => runAction(commit)}
        disabled={
          !online || !hasRepo || status.staged.length === 0 || !commitMessage.trim() || busy
        }
      >
        Commit
      </button>

      <div className="row">
        <button onClick={() => runAction(refreshStatus)} disabled={!online || !hasRepo || busy}>
          Refresh
        </button>
        <button onClick={() => runAction(pull)} disabled={!online || !hasRepo || busy}>
          Pull
        </button>
        <button onClick={() => runAction(push)} disabled={!online || !hasRepo || busy}>
          Push
        </button>
      </div>

      <h2>Recent commits</h2>
      {commits.length === 0 ? (
        <p className="empty">No commits to show.</p>
      ) : (
        <ul className="commits">
          {commits.map((entry) => (
            <li key={entry.hash}>
              <code className="hash">{entry.shortHash}</code>
              <div className="commit-meta">
                <span className="subject">{entry.subject}</span>
                <span className="byline">
                  {entry.author} · {new Date(entry.date).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
