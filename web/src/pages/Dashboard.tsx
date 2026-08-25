import { useState, useEffect } from 'react';
import { getStatus } from '../api/client';
import { useEventBus } from '../hooks/useEventBus';
import toast from 'react-hot-toast';

export function DashboardPage() {
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { subscribe } = useEventBus();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getStatus();
        setStatus(data);
      } catch (err) {
        toast.error('Failed to load status');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    return subscribe('wa:status', () => {
      // Refresh status on changes
      getStatus().then(setStatus).catch(() => {});
    });
  }, [subscribe]);

  if (isLoading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  if (!status) {
    return <div className="empty-state">Failed to load dashboard</div>;
  }

  const uptime = status.uptimeSeconds;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Dashboard</h1>

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Total Contacts</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)' }}>{status.contactCount}</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Total Messages</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--info)' }}>{status.messageCount}</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Active Conversations</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent-alt)' }}>{status.conversationCount}</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Needs Human Review</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--warning)' }}>{status.needsHumanCount}</div>
        </div>
      </div>

      {/* Status & Provider info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>WhatsApp Connection</h3>
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'var(--bg)',
              borderRadius: '4px',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor:
                    status.waStatus === 'connected'
                      ? 'var(--success)'
                      : status.waStatus === 'idle'
                      ? 'var(--muted)'
                      : 'var(--error)',
                }}
              />
              <span style={{ fontWeight: 'bold' }}>
                {status.waStatus === 'connected'
                  ? 'Connected'
                  : status.waStatus === 'idle'
                  ? 'Idle'
                  : 'Disconnected'}
              </span>
            </div>
            {status.waStatus === 'connecting' && <p style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>Connecting...</p>}
            {status.waStatus === 'qr' && <p style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>Waiting for QR scan...</p>}
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
            Uptime: {days}d {hours}h {minutes}m
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Active Provider</h3>
          {status.activeProvider ? (
            <div
              style={{
                padding: '1rem',
                backgroundColor: 'var(--bg)',
                borderRadius: '4px',
              }}
            >
              <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{status.activeProvider.name}</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '0.25rem' }}>
                Chat: {status.activeProvider.model}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                Embedding: {status.activeProvider.embeddingModel || 'Not set'}
              </p>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '1rem', color: 'var(--text-dim)' }}>
              No active provider
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>Quick Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          <a href="/pairing" style={{ padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '4px', textAlign: 'center', textDecoration: 'none' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>▦</div>
            <div>Configure Pairing</div>
          </a>
          <a href="/providers" style={{ padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '4px', textAlign: 'center', textDecoration: 'none' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🤖</div>
            <div>Manage Providers</div>
          </a>
          <a href="/conversations" style={{ padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '4px', textAlign: 'center', textDecoration: 'none' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✉</div>
            <div>Review Conversations</div>
          </a>
          <a href="/rag" style={{ padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '4px', textAlign: 'center', textDecoration: 'none' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>▤</div>
            <div>Manage RAG</div>
          </a>
        </div>
      </div>
    </div>
  );
}
