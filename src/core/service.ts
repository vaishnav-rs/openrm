import type { WASocket } from "@whiskeysockets/baileys";
import { connect, reconnectFresh } from "../whatsapp/client.js";
import { registerMessageHandlers } from "../whatsapp/handlers.js";

/**
 * Boots the WhatsApp connection + reactive message-handling pipeline,
 * WITHOUT touching Ink/`render()` at all -- the part of the old
 * `launchDashboard()` (src/cli/index.ts) that has to exist for openrm to be
 * useful even with no TUI attached at all.
 *
 * Two callers, both of which just add their own presentation layer on top:
 *  - `openrm start`/`openrm pair` (src/cli/index.ts's launchDashboard):
 *    calls this, then renders the Ink dashboard.
 *  - `openrm __server-worker` (src/server/worker.ts, spawned detached by
 *    `openrm server start`): calls this, then starts the HTTP/WS server
 *    instead of rendering anything -- headless.
 *
 * Returns the live WASocket so a caller that also wants direct access (the
 * TUI's Pairing screen re-registers handlers after reconnectFresh) can use
 * it, though most callers only need the side effect of having called this.
 */
export async function startCoreService(options: { fresh?: boolean } = {}): Promise<WASocket> {
  const sock = options.fresh ? await reconnectFresh() : await connect();
  registerMessageHandlers(sock);
  return sock;
}
