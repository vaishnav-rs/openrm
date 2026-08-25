import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";

/** Mirrors src/tui/screens/Contacts.tsx: list, get one (with interests), delete. */
export function createContactsRouter(): Router {
  const router = Router();

  router.get("/contacts", async (_req, res) => {
    const prisma = getPrisma();
    const rows = await prisma.contact.findMany({
      include: { interests: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json({
      contacts: rows.map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        updatedAt: c.updatedAt.toISOString(),
        interestCount: c.interests.length,
      })),
    });
  });

  router.get("/contacts/:id", async (req, res) => {
    const prisma = getPrisma();
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: { interests: true },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }
    const conversation = await prisma.conversation.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    });
    res.json({
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        jid: contact.jid,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
        interests: contact.interests.map((i) => ({ label: i.label, notes: i.notes })),
      },
      recentMessages: (conversation?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  router.delete("/contacts/:id", async (req, res) => {
    const prisma = getPrisma();
    try {
      await prisma.contact.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
