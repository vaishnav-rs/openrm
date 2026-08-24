import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { Boom } from "@hapi/boom";
import { getAuthDir } from "../setup/paths.js";
import { eventBus } from "../tui/events.js";

let sock: WASocket | undefined;
let connecting = false;

// Set for the duration of reconnectFresh() so the connection.update close
// handler below knows a disconnect was self-inflicted (we're intentionally
// tearing the socket down to clear a dead/stale session) and should NOT
// also fire its own auto-reconnect -- reconnectFresh() does its own
// connect() call once the stale auth dir has been cleared, and letting both
// race would mean the auto-reconnect's connect() wins with the *old*,
// about-to-be-deleted auth state.
let resetting = false;

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

  // Use fetchLatestWaWebVersion, not fetchLatestBaileysVersion, when picking
  // the WA Web version to advertise. Baileys' bundled/cached version
  // (fetchLatestBaileysVersion) has repeatedly lagged behind what WhatsApp's
  // servers actually expect while still reporting isLatest: true -- this
  // produces exactly the symptom this fix addresses: QR scan succeeds,
  // WhatsApp shows "Pairing..."/"Logging in...", then the phone reports
  // "Couldn't link device" / "Pairing unsuccessful" after the QR reference
  // times out server-side. fetchLatestWaWebVersion queries WhatsApp Web's
  // own version endpoint directly, avoiding the stale-cache mismatch.
  const { version } = await fetchLatestWaWebVersion();

  eventBus.emitTyped("wa:status", { status: "connecting" });

  const socket = makeWASocket({
    version,
    auth: state,
    // Explicit, realistic client identification for the pairing handshake.
    // WA's servers can be picky about this specifically during linking; a
    // desktop-Chrome identity is the current recommended default for the
    // QR/pairing-code flow (see Baileys' Browsers helper).
    browser: Browsers.ubuntu("Chrome"),
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
      } else if (!resetting) {
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

/**
 * Lightweight QR-refresh path: cleanly closes the current Baileys socket (if
 * any), deletes ONLY the WhatsApp auth session directory (~/.openrm/auth --
 * never config.json or soul.md), and reconnects to generate a fresh QR.
 *
 * This exists because a full `openrm reset` wipes config.json (DB
 * connection + onboarding state) and soul.md (the user's customized
 * persona) along with the auth session, forcing the entire onboarding
 * wizard to be redone just to get a new QR code -- disproportionate when
 * all that's actually needed is clearing the dead WhatsApp session. Shared
 * by both `openrm pair --fresh` (src/cli/index.ts) and the in-TUI
 * "regenerate QR" keybinding (src/tui/screens/Pairing.tsx) so there is one
 * implementation, not two.
 */
export async function reconnectFresh(): Promise<WASocket> {
  resetting = true;
  const current = sock;
  sock = undefined;
  connecting = false;

  if (current) {
    try {
      await current.end(undefined);
    } catch {
      // Socket may already be closed/dead (e.g. the very "stalled" state
      // this is meant to recover from) -- nothing more to do with it.
    }
  }

  const authDir = getAuthDir();
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
  }

  resetting = false;
  return connect();
}
