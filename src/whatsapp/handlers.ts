import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { getPrisma } from "../db/prisma.js";
import { handleInbound, parsePhoneFromJid } from "../agent/orchestrator.js";
import { eventBus } from "../tui/events.js";
import { getSock } from "./client.js";

/**
 * THERE ARE EXACTLY THREE CALL SITES OF sock.sendMessage IN THIS ENTIRE
 * CODEBASE, AND ALL THREE LIVE IN THIS FILE -- deliberately colocated so the
 * reactive-only guarantee can be audited in one place. Grep the repo for
 * "sendMessage" to verify this remains true.
 *
 * 1. handleOneMessage() below: the original, unchanged reactive reply --
 *    every new inbound, non-self message gets a reply computed via the
 *    agent orchestrator, sent back to the exact JID that sent it, and
 *    nothing else, ever. (Skipped when the conversation is humanControlled
 *    -- see the empty-reply check inside handleOneMessage.)
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
 * 3. sendManualMessage() below: fundamentally different in kind from 1 and
 *    2 -- it is NEVER triggered by the agent/LLM or by any inbound message.
 *    It exists solely so a human operator, on the dashboard's Conversations
 *    screen (src/tui/screens/ConversationsFeed.tsx), can type into a text
 *    box and press Enter to send that exact text to the one contact they
 *    are actively viewing -- the same shape of action as typing into
 *    WhatsApp Web itself, just from this dashboard instead. There is no
 *    code path from any AgentTool, MCP tool, or orchestrator logic into
 *    this function; its only caller is the Enter-key handler in the
 *    compose box of that one screen, gated on `active && mode === "compose"`
 *    (explicit human keystrokes), never reachable from handleOneMessage or
 *    any tool executor.
 *
 * openrm still never *initiates* a conversation with an external party on
 * its own: the agent never messages a customer first, and the one
 * agent-reachable non-customer send target (the staff number in #2) is a
 * fixed, business-configured internal contact, not something the agent
 * discovers or picks per-conversation. Site #3 is not the agent initiating
 * anything -- it is a human being, literally, operating this product as a
 * live-chat console; the message only exists because a person typed it.
 * There is no scheduler, cron, queue-drainer, or broadcast path anywhere in
 * this repo.
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

  // handleInbound returns "" when the conversation is humanControlled (a
  // staff member has "jumped in" from the dashboard) -- in that case it
  // deliberately generated no reply, and there is nothing to send: sending
  // an empty WhatsApp text message would be both pointless and confusing.
  // The inbound message was still persisted by handleInbound so it shows up
  // live in the dashboard thread for the human to see and answer.
  if (!reply) return;

  // Call site 1 of 3: a direct reply to the JID that just messaged us, and
  // to no one else.
  await sock.sendMessage(jid, { text: reply });

  eventBus.emitTyped("message:out", { jid, phone, text: reply, at: new Date().toISOString() });
}

/**
 * Call site 2 of 3. Sends a short internal alert to the configured
 * escalationPhone number, invoked only from request_human_handoff's tool
 * executor (src/agent/tools/handoff.ts), which itself only runs as part of
 * the tool-calling loop inside handleInbound() above -- i.e. always as a
 * direct, synchronous consequence of the current inbound customer message,
 * never on a timer or queue. See the file-level doc comment above for how
 * this and the third call site (sendManualMessage, below) are audited
 * together.
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

/**
 * Call site 3 of 3, and the only one of the three NOT reachable from any
 * tool/agent code path. Sends `text` to `phone` as a direct WhatsApp
 * message and persists it as a Message row with role "human" (see the doc
 * comment on Message.role in prisma/schema.prisma) so the dashboard can
 * show it as a staff reply, distinct from a bot reply.
 *
 * This function's ONLY caller is the Enter-key handler on the message
 * compose box in src/tui/screens/ConversationsFeed.tsx, itself gated on
 * that screen's own focus/mode state being "compose" -- i.e. only reachable
 * when a human has explicitly navigated into that box and pressed a key.
 * There is no AgentTool, MCP tool, orchestrator branch, timer, or queue
 * that calls this. It does not run request_human_handoff's tool loop,
 * does not consult AgentConfig, and does not touch needsHuman -- it is a
 * plain, deliberate one-shot send driven entirely by a human's own
 * keystrokes, functionally equivalent to a person using WhatsApp Web
 * directly, just through this dashboard instead.
 *
 * Never throws: a missing/unpaired socket or a Baileys send failure is
 * reported back to the caller as `{ sent: false, error }`, same shape as
 * notifyStaffOfEscalation above, so a transient WhatsApp outage can never
 * crash the dashboard screen the operator is actively typing in.
 */
export async function sendManualMessage(params: {
  conversationId: string;
  phone: string;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const trimmed = params.text.trim();
  if (!trimmed) return { sent: false, error: "Message text is empty." };

  const sock = getSock();
  if (!sock) {
    return { sent: false, error: "WhatsApp socket is not currently connected." };
  }

  const jid = params.phone.includes("@") ? params.phone : `${params.phone}@s.whatsapp.net`;

  try {
    await sock.sendMessage(jid, { text: trimmed });
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }

  // The WhatsApp send above already succeeded -- the message is delivered
  // regardless of what happens below. If persisting it or notifying the TUI
  // throws (bad conversationId, a transient DB hiccup), that must NOT turn
  // into an uncaught rejection: this function's only caller
  // (ComposeBox.handleSubmit in ConversationsFeed.tsx) awaits this promise
  // and only knows how to render a `{sent, error}` result, not catch a
  // throw. An uncaught rejection here would leave that screen's "Sending..."
  // spinner stuck forever with no visible error at all -- indistinguishable
  // from the send silently doing nothing, from the operator's perspective.
  try {
    const prisma = getPrisma();
    await prisma.message.create({
      data: { conversationId: params.conversationId, role: "human", content: trimmed },
    });
    eventBus.emitTyped("message:out", {
      jid,
      phone: params.phone,
      text: trimmed,
      at: new Date().toISOString(),
    });
  } catch (err) {
    // Still report success -- the customer DID receive the message -- but
    // flag that it may not show up in the dashboard's own history/live feed.
    return {
      sent: true,
      error:
        "Message was delivered, but saving it to the dashboard failed: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  return { sent: true };
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
