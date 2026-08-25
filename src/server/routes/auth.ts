import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionCookie,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";

/**
 * POST /api/auth/login and POST /api/auth/logout. These are the two routes
 * NOT gated by requireAuth in src/server/app.ts (alongside GET /api/health).
 */
export function createAuthRouter(sessionSecret: string): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      res.status(400).json({ error: "Missing 'password'." });
      return;
    }

    const prisma = getPrisma();
    const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
    if (!config?.authPasswordHash || !config.authPasswordSalt) {
      res.status(500).json({ error: "No admin password is configured on this server." });
      return;
    }

    if (!verifyPassword(password, config.authPasswordHash, config.authPasswordSalt)) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }

    const cookieValue = createSession(sessionSecret);
    setSessionCookie(res, cookieValue);
    res.json({ ok: true });
  });

  router.post("/logout", (req, res) => {
    destroySession(getSessionCookie(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
