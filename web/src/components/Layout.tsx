import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { logout } from '../api/client';
import { useAuth } from '../AuthContext';
import { useEventBus } from '../hooks/useEventBus';
import toast from 'react-hot-toast';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '▣' },
  { path: '/pairing', label: 'Pairing', icon: '▦' },
  { path: '/conversations', label: 'Conversations', icon: '✉' },
  { path: '/contacts', label: 'Contacts', icon: '☺' },
  { path: '/providers', label: 'Providers', icon: '🤖' },
  { path: '/soul', label: 'Soul', icon: '✎' },
  { path: '/system-prompt', label: 'System Prompt', icon: '⚙' },
  { path: '/rag', label: 'RAG', icon: '▤' },
  { path: '/mcp', label: 'MCP Servers', icon: '🔌' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { logout: authLogout } = useAuth();
  const [waStatus, setWaStatus] = useState('idle');
  const { subscribe } = useEventBus();

  // Subscribe to WhatsApp status updates
  subscribe('wa:status', (event) => {
    if (event.type === 'wa:status') {
      setWaStatus(event.payload.status);
    }
  });

  const handleLogout = async () => {
    try {
      await logout();
      authLogout();
      toast.success('Logged out');
    } catch (err) {
      toast.error('Logout failed');
    }
  };

  const statusColor: Record<string, string> = {
    idle: 'var(--muted)',
    connecting: 'var(--warning)',
    qr: 'var(--warning)',
    connected: 'var(--success)',
    disconnected: 'var(--error)',
    logged_out: 'var(--error)',
  };

  const statusLabel: Record<string, string> = {
    idle: 'Idle',
    connecting: 'Connecting',
    qr: 'Pairing',
    connected: 'Connected',
    disconnected: 'Disconnected',
    logged_out: 'Logged out',
  };

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      <nav
        style={{
          width: '240px',
          backgroundColor: 'var(--bg-raised)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '1rem',
          gap: '1rem',
          overflowY: 'auto',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>openrm</h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusColor[waStatus] || 'var(--muted)',
              }}
            />
            <span>{statusLabel[waStatus] || 'Unknown'}</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <ul className="list">
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  style={{
                    display: 'block',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    backgroundColor: location.pathname === item.path ? 'rgba(124, 158, 255, 0.15)' : 'transparent',
                    color: location.pathname === item.path ? 'var(--accent)' : 'var(--text)',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => {
                    if (location.pathname !== item.path) {
                      e.currentTarget.style.backgroundColor = 'rgba(124, 158, 255, 0.08)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (location.pathname !== item.path) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <span style={{ marginRight: '0.75rem' }}>{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            borderColor: 'var(--border)',
            color: 'var(--text-dim)',
          }}
        >
          Logout
        </button>
      </nav>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '1.5rem', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
