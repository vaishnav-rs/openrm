import { useState, useEffect } from 'react';
import {
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  testMcpServer,
} from '../api/client';
import toast from 'react-hot-toast';

interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
}

export function MCPPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    transport: ('stdio' as 'stdio' | 'http'),
    command: '',
    args: '',
    url: '',
  });
  const [isTesting, setIsTesting] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getMcpServers();
        setServers(data.servers);
      } catch (err) {
        toast.error('Failed to load MCP servers');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        await updateMcpServer(editId, {
          name: formData.name,
          command: formData.command || undefined,
          args: formData.args.split('\n').filter((a) => a.trim()),
          url: formData.url || undefined,
        });
        setServers((prev) =>
          prev.map((s) =>
            s.id === editId
              ? {
                  ...s,
                  name: formData.name,
                  command: formData.command || null,
                  args: formData.args.split('\n').filter((a) => a.trim()),
                  url: formData.url || null,
                }
              : s
          )
        );
        toast.success('Server updated');
      } else {
        const res = await createMcpServer({
          name: formData.name,
          transport: formData.transport,
          command: formData.command || undefined,
          args: formData.args.split('\n').filter((a) => a.trim()),
          url: formData.url || undefined,
        }) as { server: McpServer };
        setServers((prev) => [...prev, res.server]);
        toast.success('Server created');
      }
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save server';
      toast.error(msg);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', transport: 'stdio', command: '', args: '', url: '' });
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (s: McpServer) => {
    setFormData({
      name: s.name,
      transport: s.transport,
      command: s.command || '',
      args: s.args.join('\n'),
      url: s.url || '',
    });
    setEditId(s.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMcpServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      toast.success('Server deleted');
    } catch (err) {
      toast.error('Failed to delete server');
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleMcpServer(id);
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
      );
      toast.success('Server toggled');
    } catch (err) {
      toast.error('Failed to toggle server');
    }
  };

  const handleTest = async (id: string) => {
    setIsTesting(id);
    try {
      const res = await testMcpServer(id) as { tools: string[] };
      toast.success(`Found ${res.tools.length} tools: ${res.tools.join(', ')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      toast.error(msg);
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>MCP Servers</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="primary">
            Add Server
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
          Loading servers...
        </div>
      ) : (
        <>
          {showForm && (
            <div className="card" style={{ marginBottom: '2rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>{editId ? 'Edit Server' : 'New MCP Server'}</h3>
              <form onSubmit={handleSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      disabled={!!editId}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Transport</label>
                    <select
                      value={formData.transport}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          transport: e.target.value as 'stdio' | 'http',
                        })
                      }
                      disabled={!!editId}
                    >
                      <option value="stdio">Stdio</option>
                      <option value="http">HTTP</option>
                    </select>
                  </div>
                </div>

                {(formData.transport as string) === 'stdio' && (
                  <>
                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                      <label>Command</label>
                      <input
                        value={formData.command}
                        onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                        placeholder="e.g., npx mcp-server-example"
                        required
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                      <label>Arguments (one per line, optional)</label>
                      <textarea
                        value={formData.args}
                        onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                        placeholder="--flag1&#10;--flag2 value"
                        style={{ minHeight: '80px' }}
                      />
                    </div>
                  </>
                )}

                {(formData.transport as string) === 'http' && (
                  <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label>URL</label>
                    <input
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      placeholder="e.g., http://localhost:3000"
                      required
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button type="submit" className="primary">
                    Save
                  </button>
                  <button type="button" onClick={resetForm}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {servers.length === 0 ? (
            <div className="empty-state">No MCP servers configured</div>
          ) : (
            <div>
              {servers.map((s) => (
                <div key={s.id} className="card" style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                    <div>
                      <h3 style={{ marginBottom: '0.25rem' }}>{s.name}</h3>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                        {s.transport === 'stdio'
                          ? `Command: ${s.command}`
                          : `URL: ${s.url}`}
                      </p>
                    </div>
                    {s.enabled && <span className="badge badge-success">Enabled</span>}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleTest(s.id)} disabled={isTesting === s.id}>
                      {isTesting === s.id ? 'Testing...' : 'Test'}
                    </button>
                    <button onClick={() => handleToggle(s.id)}>
                      {s.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => handleEdit(s)}>Edit</button>
                    <button onClick={() => handleDelete(s.id)} className="error">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
