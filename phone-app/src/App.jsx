import React, { useState } from 'react';
import PairingScreen from './pairing/PairingScreen.jsx';
import StatusScreen from './status/StatusScreen.jsx';
import {
  loadConnections,
  saveConnections,
  addConnection,
  removeConnection,
  selectConnection,
  activeConnection,
} from './connections.js';

export default function App() {
  const [state, setState] = useState(() => loadConnections(localStorage));
  const [addingDevice, setAddingDevice] = useState(false);

  function update(next) {
    saveConnections(localStorage, next);
    setState(next);
  }

  function handlePaired(token, label) {
    update(addConnection(state, token, label));
    setAddingDevice(false);
  }

  const active = activeConnection(state);

  if (!active || addingDevice) {
    return (
      <PairingScreen
        onPaired={handlePaired}
        onCancel={active ? () => setAddingDevice(false) : null}
      />
    );
  }

  return (
    <StatusScreen
      // Remounting on switch drops the previous laptop's file list and diff,
      // so a stale repo never shows under the newly selected device.
      key={active.id}
      token={active.token}
      devices={state.devices}
      activeId={state.activeId}
      onSelectDevice={(id) => update(selectConnection(state, id))}
      onAddDevice={() => setAddingDevice(true)}
      onRemoveDevice={(id) => update(removeConnection(state, id))}
    />
  );
}
