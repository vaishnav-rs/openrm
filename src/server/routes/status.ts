import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";
import { eventBus, type WaStatus } from "../../tui/events.js";

const processStartedAt = Date.now();

// Mirrors the pattern in src/tui/events.ts's OpenrmEventBus itself (it
// caches the latest wa:status so late subscribers see current state) --
// this route needs the current status synchronously on every request, not
// just future emissions, so it keeps its own always-up-to-date mirror the
// same way.
let currentWaStatus: WaStatus = "idle";
eventBus.onTyped("wa:status", (e) => {
  currentWaStatus = e.status;
});

/**
 * GET /api/health -- deliberately NOT behind requireAuth (see
 * src/server/app.ts) so `openrm server status` can query it without ever
 * having logged in. Liveness + the minimum detail that command needs to
 * report: WhatsApp connection state and uptime.
 */
export function createHealthRouter(): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      waStatus: currentWaStatus,
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
    });
  });
  return router;
}

/**
 * GET /api/status -- the richer, AUTHENTICATED dashboard-stats endpoint
 * (contact/message counts, active provider), mirroring
 * src/tui/screens/Dashboard.tsx's own queries.
 */
export function createStatusRouter(): Router {
  const router = Router();
  router.get("/status", async (_req, res) => {
    const prisma = getPrisma();
    const [contactCount, messageCount, conversationCount, needsHumanCount, activeProvider] = await Promise.all([
      prisma.contact.count(),
      prisma.message.count(),
      prisma.conversation.count(),
      prisma.conversation.count({ where: { needsHuman: true } }),
      prisma.providerConfig.findFirst({ where: { isActive: true } }),
    ]);

    res.json({
      ok: true,
      waStatus: currentWaStatus,
      uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
      contactCount,
      messageCount,
      conversationCount,
      needsHumanCount,
      activeProvider: activeProvider
        ? { name: activeProvider.name, model: activeProvider.model, embeddingModel: activeProvider.embeddingModel }
        : null,
    });
  });
  return router;
}
