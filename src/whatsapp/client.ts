import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdirSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { getAuthDir, getLogPath, getOpenrmHome } from "../setup/paths.js";
import { eventBus } from "../tui/events.js";

// In every real CLI flow ~/.openrm already exists by the time this module is
// imported (openrm init / config.ts create it before `pair` becomes
// reachable), but the pino destination below is opened at module-load time,
// so this stays defensive rather than assuming that ordering holds forever.
if (!existsSync(getOpenrmHome())) {
  mkdirSync(getOpenrmHome(), { recursive: true });
}

// Baileys' own internal (pino) logger can reveal handshake-level details --
// e.g. the specific WebSocket frame/error during the login handshake itself,
// which happens *before* connection.update "close" ever fires -- that we'd
// otherwise never capture. It's deliberately routed to the log file, NOT
// stdout: Ink takes over the whole terminal, so anything Baileys wrote to
// stdout would visually collide with (and get clobbered by) the TUI's own
// redraws, which is likely part of why past pairing failures have had zero
// visibility into what actually happened at the protocol level.
const logPath = getLogPath();
const baileysLogger = pino({ level: "debug" }, pino.destination({ dest: logPath, sync: true }));

/**
 * Appends a single timestamped line to ~/.openrm/openrm.log. Deliberately
 * plain fs.appendFileSync (no logging library) for this app-level trail --
 * separate from baileysLogger above, which is Baileys' own internal pino
 * logger writing structured/verbose protocol-level logs to the same file.
 * Kept so the log survives the TUI being closed: past pairing failures have
 * been diagnosed completely blind because nothing outlived the process.
 */
function appendLog(line: string): void {
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // Logging must never be the reason pairing itself fails.
  }
}

/**
 * Maps a Baileys close statusCode back to its DisconnectReason name (e.g.
 * 428 -> "connectionClosed") for a readable log/detail message. Baileys
 * exports DisconnectReason as a numeric TS enum, which at runtime is an
 * object with both directions (name -> code AND code -> name) baked in, so
 * this is just an indexed lookup -- falls back to the raw numeric code if
 * it's not one of the known reasons (e.g. a raw WebSocket close code).
 */
function disconnectReasonName(statusCode: number | undefined): string {
  if (statusCode === undefined) return "unknown";
  const name = (DisconnectReason as unknown as Record<number, string>)[statusCode];
  return name ?? String(statusCode);
}

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
 * sock.sendMessage -- see that file's top-of-file doc comment for the
 * exactly three call sites this is allowed to power (the reactive customer
 * reply, the staff escalation alert, and the dashboard's manual staff-reply
 * compose box), and why each one is safe.
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
    // makeCacheableSignalKeyStore wraps state.keys so signal-protocol key
    // reads are cached instead of hitting disk on every access. Baileys'
    // own docs/examples use this rather than passing `state` directly --
    // its absence is a documented common cause of session/handshake issues
    // under real I/O latency, not just a performance nit.
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    // Explicit, realistic client identification for the pairing handshake.
    // WA's servers can be picky about this specifically during linking; a
    // desktop-Chrome identity is the current recommended default for the
    // QR/pairing-code flow (see Baileys' Browsers helper).
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
    // See baileysLogger above -- captures handshake-level detail Baileys
    // doesn't otherwise surface via connection.update at all.
    logger: baileysLogger,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      appendLog("QR code generated, waiting for scan.");
      eventBus.emitTyped("wa:qr", { qr });
      eventBus.emitTyped("wa:status", { status: "qr" });
    }

    if (connection === "open") {
      appendLog("Connection open -- paired successfully.");
      eventBus.emitTyped("wa:status", { status: "connected" });
    }

    if (connection === "close") {
      const errorDetail = lastDisconnect?.error as Boom | undefined;
      const statusCode = errorDetail?.output?.statusCode;
      const reasonName = disconnectReasonName(statusCode);
      const errorMessage = errorDetail?.message;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      // Full detail -- statusCode, its DisconnectReason name, and the Boom
      // error's own message (often the most specific piece of info; it can
      // literally contain WhatsApp-side rejection text) -- for EVERY
      // non-open close, not just the loggedOut special case. This used to
      // be thrown away entirely, which is why every pairing failure so far
      // has been diagnosed completely blind.
      const rawDetail = `statusCode=${statusCode ?? "unknown"} reason=${reasonName}${
        errorMessage ? ` message="${errorMessage}"` : ""
      }`;
      appendLog(`Connection closed. ${rawDetail}`);

      if (loggedOut) {
        eventBus.emitTyped("wa:status", {
          status: "logged_out",
          detail: `Session logged out. Re-run pairing to reconnect. (${rawDetail}) See ${logPath} for the full trail.`,
        });
      } else if (!resetting) {
        eventBus.emitTyped("wa:status", {
          status: "disconnected",
          detail: `Connection dropped, reconnecting... (${rawDetail}) See ${logPath} for the full trail.`,
        });
        // connect()'s top-of-function guard is `if (connecting && sock) return
        // sock` -- meant to stop concurrent duplicate connection attempts, but
        // `connecting` is set true and never reset back to false anywhere in
        // the normal flow (only reconnectFresh() resets it). So by the time
        // ANY close event fires -- including this very common, expected one:
        // statusCode 515/"restartRequired", which WhatsApp's servers send
        // intentionally right after a successful first pairing to force a
        // fresh socket -- both `connecting` and `sock` are still truthy from
        // the original connection. That guard was silently turning every
        // auto-reconnect into a no-op returning the already-dead socket: no
        // new connect, no new auth read, nothing -- which is why pairing
        // could scan successfully and then just hang forever on "Connection
        // dropped, reconnecting..." with no actual reconnect ever happening.
        // Clear both, mirroring exactly what reconnectFresh() already does
        // correctly, so this call actually re-enters and reconnects.
        sock = undefined;
        connecting = false;
        void (async () => {
          const newSock = await connect();
          // The NEW socket from connect() is a different object from the old,
          // dead one. But the message handler was only registered once on the
          // ORIGINAL socket at startup -- it never fires on the new socket
          // because it's listening to the old socket's events. Re-register on
          // every reconnect so incoming messages are received again. Without
          // this, messages that arrive after a drop/reconnect are silently
          // ignored forever (this was the bug: TUI open, message arrives,
          // nothing shows up, user thinks the agent is broken).
          const { registerMessageHandlers } = await import("./handlers.js");
          registerMessageHandlers(newSock);
        })();
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
