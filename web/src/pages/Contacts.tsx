import { useState, useEffect } from 'react';
import { getContacts, getContact, deleteContact } from '../api/client';
import toast from 'react-hot-toast';

interface ContactSummary {
  id: string;
  phone: string;
  name: string;
  updatedAt: string;
  interestCount: number;
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getContacts();
        setContacts(data.contacts);
      } catch (err) {
        toast.error('Failed to load contacts');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const load = async () => {
      setIsLoadingDetail(true);
      try {
        const data = await getContact(selectedId);
        setSelectedContact(data.contact);
      } catch (err) {
        toast.error('Failed to load contact');
      } finally {
        setIsLoadingDetail(false);
      }
    };
    load();
  }, [selectedId]);

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      await deleteContact(selectedId);
      setContacts((prev) => prev.filter((c) => c.id !== selectedId));
      setSelectedId(null);
      setSelectedContact(null);
      setShowDeleteConfirm(false);
      toast.success('Contact deleted');
    } catch (err) {
      toast.error('Failed to delete contact');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', height: 'calc(100vh - 200px)' }}>
      {/* Contact list */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        <h2 style={{ marginBottom: '1rem' }}>Contacts ({contacts.length})</h2>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-state">No contacts yet</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
            {contacts.map((contact) => (
              <div
                key={contact.id}
                onClick={() => setSelectedId(contact.id)}
                style={{
                  padding: '0.75rem',
                  cursor: 'pointer',
                  backgroundColor: selectedId === contact.id ? 'rgba(124, 158, 255, 0.15)' : 'transparent',
                  borderRadius: '4px',
                  marginBottom: '0.5rem',
                  borderLeft: selectedId === contact.id ? '3px solid var(--accent)' : '3px solid transparent',
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{contact.name}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{contact.phone}</div>
                {contact.interestCount > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--info)', marginTop: '0.25rem' }}>
                    {contact.interestCount} interest{contact.interestCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact detail */}
      <div>
        <h2 style={{ marginBottom: '1rem' }}>Contact Details</h2>

        {selectedId && selectedContact ? (
          isLoadingDetail ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : (
            <div>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{selectedContact.name}</h3>

                <div style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
                  <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Phone</div>
                  <div style={{ fontFamily: 'monospace', marginBottom: '1rem' }}>{selectedContact.phone}</div>

                  <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>JID</div>
                  <div style={{ fontFamily: 'monospace', marginBottom: '1rem', wordBreak: 'break-all' }}>{selectedContact.jid}</div>

                  <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Created</div>
                  <div style={{ marginBottom: '1rem' }}>{new Date(selectedContact.createdAt).toLocaleString()}</div>

                  <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Updated</div>
                  <div>{new Date(selectedContact.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              {selectedContact.interests.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Interests</h4>
                  {selectedContact.interests.map((interest: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: 'var(--bg)',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{interest.label}</div>
                      {interest.notes && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>{interest.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {selectedContact.recentMessages.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Recent Messages</h4>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {selectedContact.recentMessages.map((msg: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '0.5rem',
                          marginBottom: '0.5rem',
                          backgroundColor: msg.role === 'user' ? 'rgba(124, 158, 255, 0.1)' : 'rgba(95, 214, 143, 0.1)',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                        }}
                      >
                        <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                          {msg.role === 'user' ? 'Customer' : 'Bot'}
                        </div>
                        {msg.content}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="error"
                style={{ width: '100%' }}
              >
                Delete Contact
              </button>

              {showDeleteConfirm && (
                <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
                  <div className="modal" onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ marginBottom: '1rem' }}>Confirm Deletion</h3>
                    <p style={{ marginBottom: '1.5rem' }}>
                      Are you sure you want to delete <strong>{selectedContact.name}</strong>? This action cannot be undone.
                    </p>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1 }}>
                        Cancel
                      </button>
                      <button onClick={handleDelete} className="error" style={{ flex: 1 }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="empty-state">Select a contact to view details</div>
        )}
      </div>
    </div>
  );
}
