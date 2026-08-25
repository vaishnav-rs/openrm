import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";

/** Mirrors src/tui/screens/SystemPrompt.tsx: get/set AgentConfig.masterSystemPrompt + escalationPhone. */
export function createSystemPromptRouter(): Router {
  const router = Router();

  router.get("/system-prompt", async (_req, res) => {
    const prisma = getPrisma();
    const row = await prisma.agentConfig.findUnique({ where: { id: "1" } });
    res.json({
      masterSystemPrompt: row?.masterSystemPrompt ?? "",
      escalationPhone: row?.escalationPhone ?? "",
    });
  });

  router.put("/system-prompt", async (req, res) => {
    const masterSystemPrompt = typeof req.body?.masterSystemPrompt === "string" ? req.body.masterSystemPrompt : "";
    const escalationPhone = typeof req.body?.escalationPhone === "string" ? req.body.escalationPhone : "";
    const prisma = getPrisma();
    await prisma.agentConfig.upsert({
      where: { id: "1" },
      update: { masterSystemPrompt, escalationPhone: escalationPhone || null },
      create: { id: "1", masterSystemPrompt, escalationPhone: escalationPhone || null },
    });
    res.json({ ok: true });
  });

  return router;
}
