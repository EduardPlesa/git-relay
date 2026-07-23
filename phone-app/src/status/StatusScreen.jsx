import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../supabaseClient.js';
import { createRelayCommander } from '../relay.js';

export default function StatusScreen({
  token,
  devices = [],
  activeId = null,
  onSelectDevice,
  onAddDevice,
  onRemoveDevice,
}) {
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState({ staged: [], unstaged: [], untracked: [] });
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

  async function refreshStatus() {
    setErrorText('');
    try {
      const result = await commanderRef.current.sendCommand('status');
      setStatus(result);
      setSelectedFiles([]);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  // Without this the file lists stay empty until "Refresh Status" is pressed,
  // which leaves Stage and Commit disabled and looking broken.
  useEffect(() => {
    if (online) {
      refreshStatus();
    }
  }, [online]);

  async function viewDiff(file, staged) {
    setErrorText('');
    try {
      const result = await commanderRef.current.sendCommand('diff', { file, staged });
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
      await commanderRef.current.sendCommand('stage', { files: selectedFiles });
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function commit() {
    setErrorText('');
    setNoticeText('');
    try {
      const result = await commanderRef.current.sendCommand('commit', { message: commitMessage });
      setCommitMessage('');
      setNoticeText(`Committed ${result.commitHash.slice(0, 7)}.`);
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function push() {
    setErrorText('');
    setNoticeText('Pushing…');
    try {
      await commanderRef.current.sendCommand('push', {}, 30000);
      setNoticeText('Pushed to remote.');
    } catch (error) {
      setNoticeText('');
      setErrorText(error.message);
    }
  }

  const changedFiles = [...status.unstaged, ...status.untracked];
  const activeLabel = devices.find((d) => d.id === activeId)?.label ?? 'this laptop';

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
        disabled={!online || selectedFiles.length === 0}
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
        disabled={!online || status.staged.length === 0 || !commitMessage.trim()}
      >
        Commit
      </button>

      <div className="row">
        <button onClick={refreshStatus} disabled={!online}>
          Refresh
        </button>
        <button onClick={push} disabled={!online}>
          Push
        </button>
      </div>
    </div>
  );
}
