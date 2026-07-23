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
  const commanderRef = useRef(null);
  const channelRef = useRef(null);
  const phoneIdRef = useRef(crypto.randomUUID());

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
    setErrorText('');
    try {
      const result = await run('status');
      setStatus(result);
      setSelectedFiles([]);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function loadCommits() {
    try {
      const result = await run('log', { count: 20 });
      setCommits(result.commits);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function loadBranches() {
    try {
      const result = await run('branches');
      setBranches(result);
    } catch (error) {
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
      refreshStatus();
      loadCommits();
      loadBranches();
    }
  }, [online, repoId]);

  // Both branch and status/log change together, so refresh all three after
  // creating or switching a branch rather than leaving stale data on screen.
  async function switchBranch(name) {
    setErrorText('');
    try {
      const result = await run('checkout-branch', { name });
      setBranches(result);
      await refreshStatus();
      await loadCommits();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function createNewBranch(event) {
    event.preventDefault();
    const name = newBranchName.trim();
    if (!name) return;
    setErrorText('');
    try {
      const result = await run('create-branch', { name });
      setBranches(result);
      setNewBranchName('');
      setShowNewBranch(false);
      await refreshStatus();
      await loadCommits();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function viewDiff(file, staged) {
    setErrorText('');
    try {
      const result = await run('diff', { file, staged });
      setDiffFile(file);
      setDiffText(result.diff);
    } catch (error) {
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
      await refreshStatus();
      await loadCommits();
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

  const changedFiles = [...status.unstaged, ...status.untracked];
  const activeLabel = devices.find((d) => d.id === activeId)?.label ?? 'this laptop';
  const hasRepo = Boolean(repoId);

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
              onChange={(event) => switchBranch(event.target.value)}
            >
              {branches.all.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {showNewBranch ? (
            <form className="branch-form" onSubmit={createNewBranch}>
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
                <button type="submit" disabled={!newBranchName.trim()}>
                  Create
                </button>
                <button type="button" className="link" onClick={() => setShowNewBranch(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="link" onClick={() => setShowNewBranch(true)}>
              New branch…
            </button>
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
            </li>
          ))}
        </ul>
      )}
      <button
        className="primary wide"
        onClick={stageSelected}
        disabled={!online || !hasRepo || selectedFiles.length === 0}
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
        onClick={commit}
        disabled={!online || !hasRepo || status.staged.length === 0 || !commitMessage.trim()}
      >
        Commit
      </button>

      <div className="row">
        <button onClick={refreshStatus} disabled={!online || !hasRepo}>
          Refresh
        </button>
        <button onClick={push} disabled={!online || !hasRepo}>
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
