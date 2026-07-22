import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../supabaseClient.js';
import { createRelayCommander } from '../relay.js';

export default function StatusScreen({ token }) {
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState({ staged: [], unstaged: [], untracked: [] });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [diffText, setDiffText] = useState('');
  const [diffFile, setDiffFile] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [errorText, setErrorText] = useState('');
  const [noticeText, setNoticeText] = useState('');
  const commanderRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase.channel(token, {
      config: { presence: { key: 'phone' } },
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

  return (
    <div>
      <h1>Git Relay</h1>
      <p>Laptop: {online ? 'Online' : 'Offline'}</p>
      {!online && (
        <p style={{ color: '#a15c00' }}>
          Start the Git Relay tray app on your laptop — every action is disabled until it connects.
        </p>
      )}
      {errorText && <p style={{ color: 'red' }}>{errorText}</p>}
      {noticeText && <p style={{ color: 'green' }}>{noticeText}</p>}

      <button onClick={refreshStatus} disabled={!online}>Refresh Status</button>

      <h2>Unstaged / Untracked</h2>
      <ul>
        {[...status.unstaged, ...status.untracked].map((file) => (
          <li key={file}>
            <label>
              <input
                type="checkbox"
                checked={selectedFiles.includes(file)}
                onChange={() => toggleFile(file)}
              />
              {file}
            </label>
            <button onClick={() => viewDiff(file, false)}>View diff</button>
          </li>
        ))}
      </ul>
      <button onClick={stageSelected} disabled={!online || selectedFiles.length === 0}>
        Stage selected
      </button>

      <h2>Staged</h2>
      <ul>
        {status.staged.map((file) => (
          <li key={file}>
            {file}
            <button onClick={() => viewDiff(file, true)}>View diff</button>
          </li>
        ))}
      </ul>

      {diffFile && (
        <div>
          <h3>Diff: {diffFile}</h3>
          <pre>{diffText}</pre>
        </div>
      )}

      <h2>Commit</h2>
      <textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="Commit message"
      />
      <button
        onClick={commit}
        disabled={!online || status.staged.length === 0 || !commitMessage.trim()}
      >
        Commit
      </button>
      {online && status.staged.length === 0 && (
        <p>Stage a file before committing.</p>
      )}

      <button onClick={push} disabled={!online}>Push</button>
    </div>
  );
}
