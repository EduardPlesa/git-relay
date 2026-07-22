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
    try {
      await commanderRef.current.sendCommand('commit', { message: commitMessage });
      setCommitMessage('');
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function push() {
    setErrorText('');
    try {
      await commanderRef.current.sendCommand('push', {}, 30000);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  return (
    <div>
      <h1>Git Relay</h1>
      <p>Laptop: {online ? 'Online' : 'Offline'}</p>
      {errorText && <p style={{ color: 'red' }}>{errorText}</p>}

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
      <button onClick={stageSelected} disabled={selectedFiles.length === 0}>
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
      <button onClick={commit} disabled={status.staged.length === 0 || !commitMessage.trim()}>
        Commit
      </button>

      <button onClick={push}>Push</button>
    </div>
  );
}
