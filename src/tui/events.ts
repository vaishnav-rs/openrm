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
 *
 * wa:status and wa:qr are emitted during connect() in src/whatsapp/client.ts,
 * which is fully awaited *before* the Ink app is rendered (see
 * src/cli/index.ts) -- so the first status/QR update can fire before any
 * screen has mounted to listen for it. A plain EventEmitter has no memory of
 * past events, so that update would otherwise be lost forever and a screen
 * mounting afterward would be stuck on its initial placeholder state even
 * though WhatsApp had already moved past it. To fix that, this bus caches
 * the latest wa:status/wa:qr payload and replays it to any listener
 * registered via onTyped for those two events, in addition to delivering
 * future emissions -- so a late-mounting screen always sees current state.
 */
class OpenrmEventBus extends EventEmitter {
  private lastStatus: WaStatusEvent | undefined;
  private lastQr: WaQrEvent | undefined;

  emitTyped<K extends keyof OpenrmEventMap>(event: K, ...args: OpenrmEventMap[K]): boolean {
    if (event === "wa:status") this.lastStatus = args[0] as WaStatusEvent;
    if (event === "wa:qr") this.lastQr = args[0] as WaQrEvent;
    return this.emit(event, ...args);
  }

  onTyped<K extends keyof OpenrmEventMap>(
    event: K,
    listener: (...args: OpenrmEventMap[K]) => void
  ): this {
    this.on(event, listener as (...args: unknown[]) => void);
    if (event === "wa:status" && this.lastStatus) {
      (listener as (e: WaStatusEvent) => void)(this.lastStatus);
    } else if (event === "wa:qr" && this.lastQr) {
      (listener as (e: WaQrEvent) => void)(this.lastQr);
    }
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
