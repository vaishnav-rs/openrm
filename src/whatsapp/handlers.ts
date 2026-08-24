import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { handleInbound, parsePhoneFromJid } from "../agent/orchestrator.js";
import { eventBus } from "../tui/events.js";

/**
 * THE ONLY CALL SITE OF sock.sendMessage IN THIS ENTIRE CODEBASE.
 *
 * openrm never initiates a conversation. This handler wires
 * sock.ev.on('messages.upsert', ...): for every new inbound, non-self
 * message it computes a reply via the agent orchestrator and sends that
 * reply back to the exact JID that sent the triggering message -- and
 * nothing else, ever. There is no scheduler, cron, queue-drainer, or
 * broadcast path anywhere in this repo. Grep the repo for "sendMessage" to
 * verify this remains the sole occurrence.
 */
export function registerMessageHandlers(sock: WASocket): void {
  sock.ev.on("messages.upsert", (upsert) => {
    if (upsert.type !== "notify") return;

    for (const message of upsert.messages) {
      void handleOneMessage(sock, message);
    }
  });
}

async function handleOneMessage(sock: WASocket, message: WAMessage): Promise<void> {
  // Ignore messages we sent ourselves, and anything without a remoteJid
  // (e.g. status broadcasts) -- we only ever react to a real inbound
  // message from a real contact.
  if (message.key.fromMe) return;
  const jid = message.key.remoteJid;
  if (!jid) return;

  // Only handle 1:1 chats, never groups or broadcast lists -- this agent
  // represents the business to individual customers only.
  if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

  const text = extractText(message);
  if (!text) return;

  const phone = parsePhoneFromJid(jid);
  const now = new Date().toISOString();

  eventBus.emitTyped("message:in", { jid, phone, text, at: now });

  let reply: string;
  try {
    reply = await handleInbound(jid, text);
  } catch (err) {
    console.error("Failed to compute agent reply:", err);
    reply = "Sorry, something went wrong on my end -- please try again shortly.";
  }

  // The one and only sock.sendMessage call in the codebase: a direct reply
  // to the JID that just messaged us, and to no one else.
  await sock.sendMessage(jid, { text: reply });

  eventBus.emitTyped("message:out", { jid, phone, text: reply, at: new Date().toISOString() });
}

function extractText(message: WAMessage): string | undefined {
  const m = message.message;
  if (!m) return undefined;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    undefined
  );
}
