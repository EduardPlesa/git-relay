import React, { useState } from 'react';
import PairingScreen from './pairing/PairingScreen.jsx';

function loadStoredToken() {
  return localStorage.getItem('git-relay-token') || null;
}

export default function App() {
  const [token, setToken] = useState(loadStoredToken());

  function handlePaired(newToken) {
    localStorage.setItem('git-relay-token', newToken);
    setToken(newToken);
  }

  if (!token) {
    return <PairingScreen onPaired={handlePaired} />;
  }
  return <p>Paired! Repo status UI coming in the next task.</p>;
}
