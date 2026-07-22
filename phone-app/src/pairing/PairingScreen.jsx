import React, { useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function PairingScreen({ onPaired }) {
  const [manualToken, setManualToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const scannerRef = useRef(null);

  function submitManualToken(event) {
    event.preventDefault();
    if (manualToken.trim()) {
      onPaired(manualToken.trim());
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
          onPaired(decodedText.trim());
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
    <div>
      <h1>Pair with your laptop</h1>
      <p>Scan the QR code shown in the tray app, or enter the token manually.</p>

      {scanError && <p style={{ color: 'red' }}>{scanError}</p>}
      {!scanning && <button onClick={startScan}>Scan QR Code</button>}
      {scanning && (
        <div>
          <div id="qr-reader" style={{ width: '100%' }} />
          <button onClick={cancelScan}>Cancel</button>
        </div>
      )}

      <form onSubmit={submitManualToken}>
        <input
          value={manualToken}
          onChange={(event) => setManualToken(event.target.value)}
          placeholder="Paste pairing token"
        />
        <button type="submit">Pair</button>
      </form>
    </div>
  );
}
