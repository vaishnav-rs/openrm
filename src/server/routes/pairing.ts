import { Router } from "express";
import { reconnectFresh } from "../../whatsapp/client.js";
import { registerMessageHandlers } from "../../whatsapp/handlers.js";
import { eventBus, type WaStatus } from "../../tui/events.js";

let currentStatus: WaStatus = "idle";
let currentDetail: string | undefined;
let currentQr: string | undefined;

eventBus.onTyped("wa:status", (e) => {
  currentStatus = e.status;
  currentDetail = e.detail;
  if (e.status === "connected") currentQr = undefined;
});
eventBus.onTyped("wa:qr", (e) => {
  currentQr = e.qr;
});

/**
 * Pairing endpoints. Live QR/status updates for a Phase 2 frontend are
 * meant to come over WebSocket (wa:status/wa:qr, forwarded by
 * src/server/ws.ts from this same eventBus) -- this REST route exists so a
 * freshly-connecting client can fetch the CURRENT state once on load
 * without waiting for the next event to fire, same reasoning as
 * OpenrmEventBus's own onTyped() replay-of-last-value behavior.
 *
 * Returns the raw Baileys QR payload string (not a pre-rendered terminal
 * ASCII block like src/tui/qr.ts's renderQrToString) -- a web frontend
 * renders that with its own QR library client-side.
 */
export function createPairingRouter(): Router {
  const router = Router();

  router.get("/pairing", (_req, res) => {
    res.json({ status: currentStatus, detail: currentDetail, qr: currentQr ?? null });
  });

  // Mirrors the TUI's Pairing screen "press r to regenerate" action
  // (src/tui/screens/Pairing.tsx's handleRefresh): calls the existing
  // reconnectFresh() from src/whatsapp/client.ts, then re-registers message
  // handlers on the new socket exactly like that screen does. Does not
  // reimplement any connection logic.
  router.post("/pairing/reconnect", async (_req, res) => {
    try {
      const sock = await reconnectFresh();
      registerMessageHandlers(sock);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
