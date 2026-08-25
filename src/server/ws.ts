import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  eventBus,
  type AgentToolCallEvent,
  type ConversationEscalatedEvent,
  type MessageInEvent,
  type MessageOutEvent,
  type WaQrEvent,
  type WaStatusEvent,
} from "../tui/events.js";
import { verifySessionFromCookieHeader } from "./auth.js";

/**
 * Every event type a connected web client can receive over /api/ws. The
 * first six mirror eventBus 1:1 (see src/tui/events.ts) -- this server
 * subscribes to the SAME event bus the TUI already listens to in-process
 * and just forwards each emission as a JSON frame, rather than building any
 * parallel signaling mechanism. "embedding:pull-progress" is the one
 * server-only addition, emitted directly by the providers route while a
 * pullOllamaModel() call is in flight (see src/server/routes/providers.ts).
 */
export type WsOutboundEvent =
  | { type: "message:in"; payload: MessageInEvent }
  | { type: "message:out"; payload: MessageOutEvent }
  | { type: "wa:status"; payload: WaStatusEvent }
  | { type: "wa:qr"; payload: WaQrEvent }
  | { type: "agent:tool-call"; payload: AgentToolCallEvent }
  | { type: "conversation:escalated"; payload: ConversationEscalatedEvent }
  | { type: "embedding:pull-progress"; payload: { requestId: string; status: string; completed?: number; total?: number } }
  | { type: "embedding:pull-done"; payload: { requestId: string; ok: boolean; error?: string } };

const clients = new Set<WebSocket>();

/** Broadcasts one event to every currently-connected, authenticated WS client. */
export function broadcast(event: WsOutboundEvent): void {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

/**
 * Wires up the single authenticated WebSocket endpoint (/api/ws) on the
 * given HTTP server. Session-cookie-authenticated at the upgrade handshake
 * (same cookie/secret as the REST session middleware in src/server/auth.ts)
 * -- an unauthenticated upgrade attempt is rejected with a plain HTTP 401
 * before the WS handshake ever completes.
 */
export function attachWebSocketServer(httpServer: HttpServer, sessionSecret: string): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/ws")) {
      // Not our endpoint -- leave the socket alone for any other upgrade
      // handler (none currently exist, but this avoids destroying sockets
      // meant for something else in the future).
      return;
    }

    if (!verifySessionFromCookieHeader(req.headers.cookie, sessionSecret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  eventBus.onTyped("message:in", (payload) => broadcast({ type: "message:in", payload }));
  eventBus.onTyped("message:out", (payload) => broadcast({ type: "message:out", payload }));
  eventBus.onTyped("wa:status", (payload) => broadcast({ type: "wa:status", payload }));
  eventBus.onTyped("wa:qr", (payload) => broadcast({ type: "wa:qr", payload }));
  eventBus.onTyped("agent:tool-call", (payload) => broadcast({ type: "agent:tool-call", payload }));
  eventBus.onTyped("conversation:escalated", (payload) =>
    broadcast({ type: "conversation:escalated", payload })
  );
}
