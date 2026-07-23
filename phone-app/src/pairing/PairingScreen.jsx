import React, { useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function PairingScreen({ onPaired, onCancel }) {
  const [manualToken, setManualToken] = useState('');
  const [label, setLabel] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const scannerRef = useRef(null);

  function submitManualToken(event) {
    event.preventDefault();
    if (manualToken.trim()) {
      onPaired(manualToken.trim(), label);
    }
  }

  async function startScan() {
    try {
      setScanning(true);
      setScanError('');
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
          try {
            await scanner.stop();
          } catch (err) {
            console.error('Error stopping scanner after successful scan:', err);
          }
          setScanning(false);
          onPaired(decodedText.trim(), label);
        },
        () => {}
      );
    } catch (error) {
      setScanError(error.message);
      setScanning(false);
    }
  }

  async function cancelScan() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
      }
    } catch (error) {
      setScanError(error.message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="pair">
      <h1>{onCancel ? 'Add a laptop' : 'Pair with your laptop'}</h1>
      <p className="hint">Scan the QR code shown in the tray app, or enter the token manually.</p>

      {scanError && <p className="msg is-error">{scanError}</p>}
      {!scanning && (
        <button className="primary wide" onClick={startScan}>
          Scan QR code
        </button>
      )}
      {scanning && (
        <div>
          <div id="qr-reader" />
          <button className="wide" onClick={cancelScan}>
            Cancel
          </button>
        </div>
      )}

      <p className="sep">or</p>

      <form onSubmit={submitManualToken}>
        <input
          type="text"
          value={manualToken}
          onChange={(event) => setManualToken(event.target.value)}
          placeholder="Paste pairing token"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />
        <button className="wide" type="submit" disabled={!manualToken.trim()}>
          Pair
        </button>
      </form>

      <p className="sep">name</p>
      <input
        type="text"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Work laptop (optional)"
      />
      <p className="hint">Shown in the device switcher, so you can tell your laptops apart.</p>

      {onCancel && (
        <button className="wide" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
