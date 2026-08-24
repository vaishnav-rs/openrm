import { EventEmitter } from "node:events";

export type WaStatus =
  | "idle"
  | "connecting"
  | "qr"
  | "connected"
  | "disconnected"
  | "logged_out";

export interface MessageInEvent {
  jid: string;
  phone: string;
  text: string;
  at: string;
}

export interface MessageOutEvent {
  jid: string;
  phone: string;
  text: string;
  at: string;
}

export interface WaStatusEvent {
  status: WaStatus;
  detail?: string;
}

export interface WaQrEvent {
  qr: string;
}

export interface AgentToolCallEvent {
  jid: string;
  tool: string;
  arguments: Record<string, unknown>;
  at: string;
}

interface OpenrmEventMap {
  "message:in": [MessageInEvent];
  "message:out": [MessageOutEvent];
  "wa:status": [WaStatusEvent];
  "wa:qr": [WaQrEvent];
  "agent:tool-call": [AgentToolCallEvent];
}

/**
 * Typed singleton EventEmitter. This is the sole channel by which the
 * whatsapp/ and agent/ layers communicate live state to the tui/ layer --
 * the TUI never reaches into Baileys or the orchestrator directly.
 */
class OpenrmEventBus extends EventEmitter {
  emitTyped<K extends keyof OpenrmEventMap>(event: K, ...args: OpenrmEventMap[K]): boolean {
    return this.emit(event, ...args);
  }

  onTyped<K extends keyof OpenrmEventMap>(
    event: K,
    listener: (...args: OpenrmEventMap[K]) => void
  ): this {
    this.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  offTyped<K extends keyof OpenrmEventMap>(
    event: K,
    listener: (...args: OpenrmEventMap[K]) => void
  ): this {
    this.off(event, listener as (...args: unknown[]) => void);
    return this;
  }
}

export const eventBus = new OpenrmEventBus();
eventBus.setMaxListeners(50);
