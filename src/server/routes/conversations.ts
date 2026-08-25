import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";
import { sendManualMessage } from "../../whatsapp/handlers.js";

const THREAD_HISTORY_LIMIT = 200;

/**
 * Mirrors src/tui/screens/ConversationsFeed.tsx's functionality: list
 * conversations (with needsHuman/humanControlled flags), fetch a thread,
 * send a manual staff reply, and toggle jump-in/release. Live updates for a
 * frontend come over WebSocket (message:in/message:out/conversation:escalated,
 * see src/server/ws.ts) rather than being duplicated here.
 */
export function createConversationsRouter(): Router {
  const router = Router();

  router.get("/conversations", async (_req, res) => {
    const prisma = getPrisma();
    const rows = await prisma.conversation.findMany({
      include: {
        contact: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      take: 200,
    });
    const mapped = rows
      .map((r) => {
        const last = r.messages[0];
        return {
          id: r.id,
          contactId: r.contactId,
          phone: r.contact.phone,
          jid: r.contact.jid,
          name: r.contact.name,
          needsHuman: r.needsHuman,
          humanControlled: r.humanControlled,
          lastText: last?.content ?? "",
          lastAt: (last?.createdAt ?? r.createdAt).toISOString(),
        };
      })
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    res.json({ conversations: mapped });
  });

  router.get("/conversations/:id/messages", async (req, res) => {
    const prisma = getPrisma();
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: "asc" },
      take: THREAD_HISTORY_LIMIT,
    });
    res.json({
      conversation: {
        id: conversation.id,
        needsHuman: conversation.needsHuman,
        humanControlled: conversation.humanControlled,
      },
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
    });
  });

  // Sends a manual staff reply. Calls the EXISTING sendManualMessage from
  // src/whatsapp/handlers.ts (the human-operator manual send, call site 3
  // of 3 of sock.sendMessage in the whole codebase) rather than
  // reimplementing any WhatsApp-sending logic -- see that file's top-of-file
  // doc comment.
  router.post("/conversations/:id/reply", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) {
      res.status(400).json({ error: "Missing 'text'." });
      return;
    }

    const prisma = getPrisma();
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { contact: true },
    });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    const result = await sendManualMessage({
      conversationId: conversation.id,
      phone: conversation.contact.phone,
      jid: conversation.contact.jid,
      text,
    });

    if (!result.sent) {
      res.status(502).json({ error: result.error ?? "Failed to send." });
      return;
    }
    res.json({ ok: true, error: result.error });
  });

  // Toggles Conversation.humanControlled -- identical to the TUI's "j"
  // (jump-in / release-to-bot) keybinding in ConversationsFeed.tsx, just a
  // direct DB update, same as that screen's own toggleHumanControlled().
  router.post("/conversations/:id/toggle-human", async (req, res) => {
    const prisma = getPrisma();
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { humanControlled: !conversation.humanControlled },
    });
    res.json({ ok: true, humanControlled: updated.humanControlled });
  });

  return router;
}
