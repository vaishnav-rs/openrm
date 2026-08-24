import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { handleInbound, parsePhoneFromJid } from "../agent/orchestrator.js";
import { eventBus } from "../tui/events.js";
import { getSock } from "./client.js";

/**
 * THERE ARE EXACTLY TWO CALL SITES OF sock.sendMessage IN THIS ENTIRE
 * CODEBASE, AND BOTH LIVE IN THIS FILE -- deliberately colocated so the
 * reactive-only guarantee can be audited in one place. Grep the repo for
 * "sendMessage" to verify this remains true.
 *
 * 1. handleOneMessage() below: the original, unchanged reactive reply --
 *    every new inbound, non-self message gets a reply computed via the
 *    agent orchestrator, sent back to the exact JID that sent it, and
 *    nothing else, ever.
 * 2. notifyStaffOfEscalation() below: a narrow, deliberate extension added
 *    for the human-handoff feature. It fires ONLY from inside
 *    handleOneMessage's synchronous call chain -- i.e. only in direct,
 *    reactive response to that same inbound customer message, when (and
 *    only when) the agent's request_human_handoff tool decides this
 *    customer's message warrants alerting a human (see
 *    src/agent/tools/handoff.ts for the exact trigger policy: the customer
 *    explicitly asked for a human, or the agent has genuinely exhausted its
 *    ability to help). It sends to a single pre-configured internal staff
 *    number (AgentConfig.escalationPhone), never to a customer or any other
 *    new external party, and never on any timer/schedule/queue.
 *
 * openrm still never *initiates* a conversation with an external party: it
 * never messages a customer first, and the one non-customer send target
 * (the staff number) is a fixed, business-configured internal contact, not
 * something the agent discovers or picks per-conversation. There is no
 * scheduler, cron, queue-drainer, or broadcast path anywhere in this repo.
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

  // Call site 1 of 2: a direct reply to the JID that just messaged us, and
  // to no one else.
  await sock.sendMessage(jid, { text: reply });

  eventBus.emitTyped("message:out", { jid, phone, text: reply, at: new Date().toISOString() });
}

/**
 * Call site 2 of 2. Sends a short internal alert to the configured
 * escalationPhone number, invoked only from request_human_handoff's tool
 * executor (src/agent/tools/handoff.ts), which itself only runs as part of
 * the tool-calling loop inside handleInbound() above -- i.e. always as a
 * direct, synchronous consequence of the current inbound customer message,
 * never on a timer or queue. Deliberately the only other place in the
 * codebase allowed to call sock.sendMessage, so the reactive-only guarantee
 * stays auditable by grepping this one file.
 *
 * Never throws: a missing/unpaired socket or a Baileys send failure is
 * reported back to the caller as `{ sent: false, error }` so a WhatsApp
 * outage can never crash or block the conversation that triggered it --
 * the conversation is still flagged needsHuman in the DB regardless of
 * whether this notification succeeds.
 */
export async function notifyStaffOfEscalation(params: {
  escalationPhone: string;
  customerPhone: string;
  customerName?: string | null;
  reason: string;
}): Promise<{ sent: boolean; error?: string }> {
  const sock = getSock();
  if (!sock) {
    return { sent: false, error: "WhatsApp socket is not currently connected." };
  }

  const staffJid = params.escalationPhone.includes("@")
    ? params.escalationPhone
    : `${params.escalationPhone}@s.whatsapp.net`;

  const who = params.customerName
    ? `${params.customerName} (${params.customerPhone})`
    : params.customerPhone;

  const text =
    `A customer needs a human -- please take over on WhatsApp.\n\n` +
    `Customer: ${who}\n` +
    `Reason: ${params.reason}`;

  try {
    await sock.sendMessage(staffJid, { text });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
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
