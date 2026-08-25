import { useState, useEffect } from 'react';
import {
  getProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  activateProvider,
  testProvider,
} from '../api/client';
import { useEventBus } from '../hooks/useEventBus';
import toast from 'react-hot-toast';

interface Provider {
  id: string;
  name: string;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  embeddingModel: string | null;
  isActive: boolean;
}

const KNOWN_MODELS = [
  { name: 'nomic-embed-text:latest', dims: 768 },
  { name: 'mxbai-embed-large:latest', dims: 1024 },
  { name: 'all-minilm:latest', dims: 384 },
];

export function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', model: '', apiKey: '', baseUrl: '', embeddingModel: '' });
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [isPulling, setIsPulling] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<Record<string, { status: string; completed?: number; total?: number }>>({});
  const { subscribe } = useEventBus();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getProviders();
        setProviders(data.providers);
      } catch (err) {
        toast.error('Failed to load providers');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Subscribe to embedding pull progress
  useEffect(() => {
    const unsubscribe = subscribe('embedding:pull-progress', (event) => {
      if (event.type === 'embedding:pull-progress') {
        const payload = event.payload;
        setPullProgress((prev) => ({
          ...prev,
          [payload.requestId]: { status: payload.status, completed: payload.completed, total: payload.total },
        }));
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // Subscribe to embedding pull done
  useEffect(() => {
    const unsubscribe = subscribe('embedding:pull-done', (event) => {
      if (event.type === 'embedding:pull-done') {
        const payload = event.payload;
        setPullProgress((prev) => {
          const newState = { ...prev };
          delete newState[payload.requestId];
          return newState;
        });
        setIsPulling(null);
        if (payload.ok) {
          toast.success('Embedding model pulled successfully');
        } else {
          toast.error(payload.error || 'Failed to pull embedding model');
        }
      }
    });
    return unsubscribe;
  }, [subscribe]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        await updateProvider(editId, {
          apiKey: formData.apiKey || undefined,
          baseUrl: formData.baseUrl || undefined,
          model: formData.model,
          embeddingModel: formData.embeddingModel || undefined,
        });
        setProviders((prev) =>
          prev.map((p) =>
            p.id === editId
              ? { ...p, model: formData.model, embeddingModel: formData.embeddingModel || null }
              : p
          )
        );
        toast.success('Provider updated');
      } else {
        const res = await createProvider({
          name: formData.name,
          model: formData.model,
          apiKey: formData.apiKey || undefined,
          baseUrl: formData.baseUrl || undefined,
          embeddingModel: formData.embeddingModel || undefined,
        }) as { provider: Provider };
        setProviders((prev) => [...prev, res.provider]);
        toast.success('Provider created');
      }
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save provider';
      toast.error(msg);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', model: '', apiKey: '', baseUrl: '', embeddingModel: '' });
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (p: Provider) => {
    setFormData({
      name: p.name,
      model: p.model,
      apiKey: p.apiKey || '',
      baseUrl: p.baseUrl || '',
      embeddingModel: p.embeddingModel || '',
    });
    setEditId(p.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      toast.success('Provider deleted');
    } catch (err) {
      toast.error('Failed to delete provider');
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await activateProvider(id);
      setProviders((prev) =>
        prev.map((p) => ({ ...p, isActive: p.id === id }))
      );
      toast.success('Provider activated');
    } catch (err) {
      toast.error('Failed to activate provider');
    }
  };

  const handleTest = async (id: string) => {
    setIsTesting(id);
    try {
      const res = await testProvider(id) as { message?: string };
      toast.success(res.message || 'Provider test passed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      toast.error(msg);
    } finally {
      setIsTesting(null);
    }
  };

  const progress = Object.values(pullProgress)[0];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Providers</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="primary">
            Add Provider
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
          Loading providers...
        </div>
      ) : (
        <>
          {showForm && (
            <div className="card" style={{ marginBottom: '2rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>{editId ? 'Edit Provider' : 'New Provider'}</h3>
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
                    <label>Model</label>
                    <input
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      placeholder="e.g., gpt-4, claude-3"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>API Key (optional)</label>
                    <input
                      type="password"
                      value={formData.apiKey}
                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Base URL (optional)</label>
                    <input
                      value={formData.baseUrl}
                      onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                      placeholder="e.g., http://localhost:11434"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Embedding Model (optional)</label>
                  <select
                    value={formData.embeddingModel}
                    onChange={(e) => setFormData({ ...formData, embeddingModel: e.target.value })}
                  >
                    <option value="">None</option>
                    {KNOWN_MODELS.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.dims}d)
                      </option>
                    ))}
                  </select>
                </div>

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

          {providers.length === 0 ? (
            <div className="empty-state">No providers configured</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {providers.map((p) => (
                <div key={p.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                    <h3>{p.name}</h3>
                    {p.isActive && <span className="badge badge-success">Active</span>}
                  </div>

                  <div style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                    <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Model</div>
                    <div style={{ fontFamily: 'monospace', marginBottom: '0.75rem' }}>{p.model}</div>

                    {p.embeddingModel && (
                      <>
                        <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Embedding</div>
                        <div style={{ fontFamily: 'monospace', marginBottom: '0.75rem' }}>{p.embeddingModel}</div>
                      </>
                    )}
                  </div>

                  {progress && isPulling === p.id && (
                    <div style={{ marginBottom: '1rem', padding: '0.5rem', backgroundColor: 'var(--bg)', borderRadius: '4px' }}>
                      <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        {progress.status} {progress.completed && progress.total ? `${progress.completed}/${progress.total}` : ''}
                      </div>
                      <div style={{ height: '6px', backgroundColor: 'var(--bg-raised)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            backgroundColor: 'var(--accent)',
                            width: progress.completed && progress.total ? `${(progress.completed / progress.total) * 100}%` : '0%',
                            transition: 'width 0.2s',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', fontSize: '0.9rem' }}>
                    {!p.isActive && (
                      <button onClick={() => handleActivate(p.id)} className="success" style={{ width: '100%' }}>
                        Activate
                      </button>
                    )}
                    <button onClick={() => handleTest(p.id)} disabled={isTesting === p.id} style={{ width: '100%' }}>
                      {isTesting === p.id ? 'Testing...' : 'Test'}
                    </button>
                    <button onClick={() => handleEdit(p)} style={{ width: '100%' }}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="error" style={{ width: '100%' }}>
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
