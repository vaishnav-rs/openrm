import { useState, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { getPairing, reconnectPairing } from '../api/client';
import { useEventBus } from '../hooks/useEventBus';
import toast from 'react-hot-toast';

export function PairingPage() {
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState<string>();
  const [qr, setQr] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { subscribe } = useEventBus();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getPairing();
        setStatus(data.status);
        setDetail(data.detail);
        setQr(data.qr);
      } catch (err) {
        toast.error('Failed to load pairing status');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Subscribe to status updates
  useEffect(() => {
    return subscribe('wa:status', (event) => {
      if (event.type === 'wa:status') {
        setStatus(event.payload.status);
        setDetail(event.payload.detail);
      }
    });
  }, [subscribe]);

  // Subscribe to QR updates
  useEffect(() => {
    return subscribe('wa:qr', (event) => {
      if (event.type === 'wa:qr') {
        setQr(event.payload.qr);
      }
    });
  }, [subscribe]);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await reconnectPairing();
      toast.success('Reconnect initiated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reconnect';
      toast.error(msg);
    } finally {
      setIsReconnecting(false);
    }
  };

  const statusLabel: Record<string, string> = {
    idle: 'Idle',
    connecting: 'Connecting',
    qr: 'Pairing',
    connected: 'Connected',
    disconnected: 'Disconnected',
    logged_out: 'Logged out',
  };

  if (isLoading) {
    return (
      <div>
        <h1 style={{ marginBottom: '2rem' }}>Pairing</h1>
        <div className="loading">
          <div className="spinner" />
          Loading pairing status...
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>WhatsApp Pairing</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', maxWidth: '1000px' }}>
        {/* Status section */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Connection Status</h3>

          <div
            style={{
              padding: '1.5rem',
              backgroundColor: 'var(--bg)',
              borderRadius: '6px',
              marginBottom: '1.5rem',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor:
                  status === 'connected'
                    ? 'rgba(95, 214, 143, 0.2)'
                    : status === 'qr'
                    ? 'rgba(242, 201, 76, 0.2)'
                    : 'rgba(107, 114, 128, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
              }}
            >
              <span
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor:
                    status === 'connected'
                      ? 'var(--success)'
                      : status === 'qr'
                      ? 'var(--warning)'
                      : 'var(--muted)',
                }}
              />
            </div>

            <h2 style={{ marginBottom: '0.5rem' }}>{statusLabel[status] || 'Unknown'}</h2>
            {detail && <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{detail}</p>}
          </div>

          {status === 'connected' && (
            <div style={{ padding: '1rem', backgroundColor: 'rgba(95, 214, 143, 0.1)', borderRadius: '4px', color: 'var(--success)', marginBottom: '1rem' }}>
              ✓ Successfully paired and connected
            </div>
          )}

          {status === 'disconnected' && (
            <div style={{ padding: '1rem', backgroundColor: 'rgba(255, 107, 107, 0.1)', borderRadius: '4px', color: 'var(--error)', marginBottom: '1rem' }}>
              ✗ Connection lost. Please regenerate QR.
            </div>
          )}

          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="primary"
            style={{ width: '100%' }}
          >
            {isReconnecting ? 'Regenerating...' : 'Regenerate QR Code'}
          </button>
        </div>

        {/* QR Code section */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Scan QR Code</h3>

          {qr ? (
            <div
              style={{
                backgroundColor: 'white',
                padding: '1rem',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <QRCodeCanvas value={qr} size={200} level="H" includeMargin={true} />
            </div>
          ) : (
            <div
              style={{
                backgroundColor: 'var(--bg)',
                padding: '3rem 1rem',
                borderRadius: '6px',
                textAlign: 'center',
                color: 'var(--text-dim)',
                marginBottom: '1rem',
              }}
            >
              {status === 'connected' ? 'Already paired' : 'No QR available - regenerate to pair'}
            </div>
          )}

          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>
            1. Click "Regenerate QR Code" if not seeing a QR
            <br />
            2. Open WhatsApp on your phone
            <br />
            3. Go to Settings → Linked Devices
            <br />
            4. Tap "Link a device" and scan the QR code
          </p>

          {status === 'qr' && (
            <div style={{ padding: '0.75rem', backgroundColor: 'rgba(242, 201, 76, 0.1)', borderRadius: '4px', fontSize: '0.9rem', color: 'var(--warning)' }}>
              ⏱ Waiting for QR scan...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
