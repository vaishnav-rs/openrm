import { useState, useEffect } from 'react';
import { getSoul, updateSoul } from '../api/client';
import toast from 'react-hot-toast';

export function SoulPage() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getSoul();
        setContent(data.content);
      } catch (err) {
        toast.error('Failed to load soul');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsDirty(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSoul(content);
      setIsDirty(false);
      toast.success('Soul saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save soul';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <h1 style={{ marginBottom: '2rem' }}>Soul</h1>
        <div className="loading">
          <div className="spinner" />
          Loading soul...
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>Soul</h1>
        {isDirty && (
          <span style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>Unsaved changes</span>
        )}
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
          Define the agent's soul — a plain-text description of its personality, values, and behavior.
          This is persisted at ~/.openrm/soul.md and guides the LLM's responses.
        </p>

        <textarea
          value={content}
          onChange={handleChange}
          placeholder="Write your agent's soul here..."
          style={{ width: '100%', minHeight: '400px' }}
        />

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="primary"
          >
            {isSaving ? 'Saving...' : 'Save Soul'}
          </button>
          {isDirty && (
            <button
              onClick={() => {
                setContent(content); // Reset to current saved state
                setIsDirty(false);
              }}
            >
              Discard Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
