import { useState, useEffect } from 'react';
import { getConversations, getConversationMessages, sendReply, toggleHumanControl } from '../api/client';
import { useEventBus } from '../hooks/useEventBus';
import toast from 'react-hot-toast';

interface Conversation {
  id: string;
  phone: string;
  name: string;
  needsHuman: boolean;
  humanControlled: boolean;
  lastText: string;
  lastAt: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyText, setReplyText] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { subscribe } = useEventBus();

  // Load conversations list
  useEffect(() => {
    const load = async () => {
      try {
        const data = await getConversations();
        setConversations(data.conversations);
        if (data.conversations.length > 0 && !selectedId) {
          setSelectedId(data.conversations[0].id);
        }
      } catch (err) {
        toast.error('Failed to load conversations');
      } finally {
        setIsLoadingList(false);
      }
    };
    load();
  }, []);

  // Load messages when selected conversation changes
  useEffect(() => {
    if (!selectedId) return;

    const load = async () => {
      setIsLoadingThread(true);
      try {
        const data = await getConversationMessages(selectedId);
        setSelectedConv(data.conversation);
        setMessages(data.messages);
      } catch (err) {
        toast.error('Failed to load messages');
      } finally {
        setIsLoadingThread(false);
      }
    };
    load();
  }, [selectedId]);

  // Subscribe to incoming messages
  useEffect(() => {
    return subscribe('message:in', (event) => {
      if (event.type === 'message:in') {
        const payload = event.payload;
        // Update messages if this conversation is open
        if (selectedId && messages.some((m) => m.id === payload.conversationId)) {
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(),
              role: 'user',
              content: payload.content,
              createdAt: payload.timestamp,
            },
          ]);
        }
        // Update conversation list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === payload.conversationId
              ? { ...c, lastText: payload.content, lastAt: payload.timestamp }
              : c
          )
        );
      }
    });
  }, [subscribe, selectedId, messages]);

  // Subscribe to outgoing messages
  useEffect(() => {
    return subscribe('message:out', (event) => {
      if (event.type === 'message:out') {
        const payload = event.payload;
        if (selectedId && messages.some((m) => m.id === payload.conversationId)) {
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(),
              role: 'assistant',
              content: payload.content,
              createdAt: payload.timestamp,
            },
          ]);
        }
      }
    });
  }, [subscribe, selectedId, messages]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !replyText.trim()) return;

    setIsSending(true);
    try {
      await sendReply(selectedId, replyText);
      setReplyText('');
      toast.success('Reply sent');
      // Refresh messages
      const data = await getConversationMessages(selectedId);
      setMessages(data.messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send reply';
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleHuman = async () => {
    if (!selectedId) return;
    try {
      await toggleHumanControl(selectedId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, humanControlled: !c.humanControlled } : c
        )
      );
      if (selectedConv) {
        setSelectedConv({ ...selectedConv, humanControlled: !selectedConv.humanControlled });
      }
      toast.success(selectedConv?.humanControlled ? 'Released to bot' : 'Jumped in');
    } catch (err) {
      toast.error('Failed to toggle human control');
    }
  };

  return (
    <div style={{ display: 'flex', gap: '2rem', height: 'calc(100vh - 200px)' }}>
      {/* Conversation list */}
      <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        <h2 style={{ marginBottom: '1rem' }}>Conversations</h2>

        {isLoadingList ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">No conversations yet</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                style={{
                  padding: '0.75rem',
                  cursor: 'pointer',
                  backgroundColor: selectedId === conv.id ? 'rgba(124, 158, 255, 0.15)' : 'transparent',
                  borderRadius: '4px',
                  marginBottom: '0.5rem',
                  transition: 'all 0.2s',
                  borderLeft: selectedId === conv.id ? '3px solid var(--accent)' : '3px solid transparent',
                }}
                onMouseOver={(e) => {
                  if (selectedId !== conv.id) {
                    e.currentTarget.style.backgroundColor = 'rgba(124, 158, 255, 0.08)';
                  }
                }}
                onMouseOut={(e) => {
                  if (selectedId !== conv.id) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{conv.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{conv.phone}</div>
                  </div>
                  {conv.needsHuman && <span className="badge badge-warning">Escalated</span>}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {conv.lastText}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedId && selectedConv ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ marginBottom: '0.25rem' }}>{selectedConv.name || 'Conversation'}</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{selectedConv.phone}</p>
              </div>
              <button
                onClick={handleToggleHuman}
                className={selectedConv.humanControlled ? 'error' : 'success'}
              >
                {selectedConv.humanControlled ? 'Release to Bot' : 'Jump In'}
              </button>
            </div>

            {/* Messages */}
            {isLoadingThread ? (
              <div className="loading">
                <div className="spinner" />
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', paddingRight: '0.5rem' }}>
                {messages.length === 0 ? (
                  <div className="empty-state">No messages</div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        backgroundColor: msg.role === 'user' ? 'rgba(124, 158, 255, 0.1)' : 'rgba(95, 214, 143, 0.1)',
                        borderRadius: '4px',
                        borderLeft: `3px solid ${msg.role === 'user' ? 'var(--accent)' : 'var(--success)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                          {msg.role === 'user' ? 'Customer' : 'Bot'}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.95rem' }}>{msg.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Reply form */}
            {selectedConv.humanControlled && (
              <form onSubmit={handleSendReply} style={{ display: 'flex', gap: '0.5rem' }}>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  disabled={isSending}
                  style={{ flex: 1, minHeight: '60px', resize: 'none' }}
                />
                <button type="submit" className="primary" disabled={isSending || !replyText.trim()}>
                  {isSending ? 'Sending...' : 'Send'}
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="empty-state">Select a conversation to view messages</div>
        )}
      </div>
    </div>
  );
}
