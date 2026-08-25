import { useEffect, useRef, useCallback } from 'react';

export interface MessageInEvent {
  conversationId: string;
  phone: string;
  content: string;
  timestamp: string;
}

export interface MessageOutEvent {
  conversationId: string;
  phone: string;
  content: string;
  timestamp: string;
}

export interface WaStatusEvent {
  status: string;
  detail?: string;
}

export interface WaQrEvent {
  qr: string;
}

export interface AgentToolCallEvent {
  conversationId: string;
  toolName: string;
  input: unknown;
  timestamp: string;
}

export interface ConversationEscalatedEvent {
  conversationId: string;
  timestamp: string;
}

export interface EmbeddingPullProgressEvent {
  requestId: string;
  status: string;
  completed?: number;
  total?: number;
}

export interface EmbeddingPullDoneEvent {
  requestId: string;
  ok: boolean;
  error?: string;
}

export type WsOutboundEvent =
  | { type: 'message:in'; payload: MessageInEvent }
  | { type: 'message:out'; payload: MessageOutEvent }
  | { type: 'wa:status'; payload: WaStatusEvent }
  | { type: 'wa:qr'; payload: WaQrEvent }
  | { type: 'agent:tool-call'; payload: AgentToolCallEvent }
  | { type: 'conversation:escalated'; payload: ConversationEscalatedEvent }
  | { type: 'embedding:pull-progress'; payload: EmbeddingPullProgressEvent }
  | { type: 'embedding:pull-done'; payload: EmbeddingPullDoneEvent };

type EventHandler = (event: WsOutboundEvent) => void;

/**
 * Hook for subscribing to real-time WebSocket events from the server.
 * Auto-reconnects on disconnect. Handlers are called immediately with each event.
 */
export function useEventBus() {
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const connectFnRef = useRef<(() => void) | null>(null);

  // Initialize connect function
  if (!connectFnRef.current) {
    connectFnRef.current = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

      ws.onopen = () => {
        console.log('[EventBus] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsOutboundEvent;
          const handlers = handlersRef.current.get(msg.type);
          if (handlers) {
            handlers.forEach((handler) => handler(msg));
          }
        } catch (err) {
          console.error('[EventBus] Failed to parse message:', err);
        }
      };

      ws.onerror = () => {
        console.error('[EventBus] WebSocket error');
      };

      ws.onclose = () => {
        console.log('[EventBus] Disconnected, reconnecting in 2s...');
        wsRef.current = null;
        // Reconnect after 2 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (connectFnRef.current) {
            connectFnRef.current();
          }
        }, 2000);
      };

      wsRef.current = ws;
    };
  }

  // Connect on mount
  useEffect(() => {
    if (connectFnRef.current) {
      connectFnRef.current();
    }
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const subscribe = useCallback(
    (eventType: string, handler: EventHandler) => {
      if (!handlersRef.current.has(eventType)) {
        handlersRef.current.set(eventType, new Set());
      }
      handlersRef.current.get(eventType)!.add(handler);

      return () => {
        handlersRef.current.get(eventType)?.delete(handler);
      };
    },
    []
  );

  return { subscribe };
}
