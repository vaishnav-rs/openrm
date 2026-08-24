import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdirSync, existsSync } from "node:fs";
import { Boom } from "@hapi/boom";
import { getAuthDir } from "../setup/paths.js";
import { eventBus } from "../tui/events.js";

let sock: WASocket | undefined;
let connecting = false;

/**
 * Returns the current Baileys socket, if a connection has been established
 * via connect(). Only src/whatsapp/handlers.ts should use this to call
 * sock.sendMessage -- and only ever in direct reply to an inbound message.
 */
export function getSock(): WASocket | undefined {
  return sock;
}

/**
 * Sets up the Baileys socket using useMultiFileAuthState pointed at
 * ~/.openrm/auth, wires reconnect-on-drop logic, and emits wa:status/wa:qr
 * events on the shared event bus for the TUI's Pairing/Dashboard screens to
 * render. Does not itself send any messages -- that only happens in
 * src/whatsapp/handlers.ts, in direct reply to an inbound message.
 */
export async function connect(): Promise<WASocket> {
  if (connecting && sock) return sock;
  connecting = true;

  const authDir = getAuthDir();
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  eventBus.emitTyped("wa:status", { status: "connecting" });

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      eventBus.emitTyped("wa:qr", { qr });
      eventBus.emitTyped("wa:status", { status: "qr" });
    }

    if (connection === "open") {
      eventBus.emitTyped("wa:status", { status: "connected" });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        eventBus.emitTyped("wa:status", {
          status: "logged_out",
          detail: "Session logged out. Re-run pairing to reconnect.",
        });
      } else {
        eventBus.emitTyped("wa:status", {
          status: "disconnected",
          detail: "Connection dropped, reconnecting...",
        });
        void connect();
      }
    }
  });

  sock = socket;
  return socket;
}
