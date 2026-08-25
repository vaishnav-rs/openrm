import { useState, useEffect } from 'react';
import { getSystemPrompt, updateSystemPrompt } from '../api/client';
import toast from 'react-hot-toast';

export function SystemPromptPage() {
  const [masterSystemPrompt, setMasterSystemPrompt] = useState('');
  const [escalationPhone, setEscalationPhone] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getSystemPrompt();
        setMasterSystemPrompt(data.masterSystemPrompt);
        setEscalationPhone(data.escalationPhone);
      } catch (err) {
        toast.error('Failed to load system prompt');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSystemPrompt({
        masterSystemPrompt,
        escalationPhone,
      });
      setIsDirty(false);
      toast.success('System prompt saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save system prompt';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <h1 style={{ marginBottom: '2rem' }}>System Prompt</h1>
        <div className="loading">
          <div className="spinner" />
          Loading system prompt...
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>System Prompt</h1>
        {isDirty && (
          <span style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>Unsaved changes</span>
        )}
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
          Configure the master system prompt that guides the LLM agent and the escalation phone number
          for urgent situations.
        </p>

        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <label>Master System Prompt</label>
          <textarea
            value={masterSystemPrompt}
            onChange={(e) => {
              setMasterSystemPrompt(e.target.value);
              setIsDirty(true);
            }}
            placeholder="Write your system prompt here. This instructs the LLM on how to behave..."
            style={{ width: '100%', minHeight: '300px' }}
          />
          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
            This prompt is sent to the LLM on every request to guide its behavior and responses.
          </p>
        </div>

        <div className="form-group" style={{ marginBottom: '1.5rem' }}>
          <label>Escalation Phone Number</label>
          <input
            type="tel"
            value={escalationPhone}
            onChange={(e) => {
              setEscalationPhone(e.target.value);
              setIsDirty(true);
            }}
            placeholder="e.g., +1234567890"
          />
          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
            The phone number to escalate to when conversations need human intervention.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="primary"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
          {isDirty && (
            <button
              onClick={() => {
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
