import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Router } from "express";
import { getOpenrmHome, getSoulPath } from "../../setup/paths.js";

/** Mirrors src/tui/screens/Soul.tsx: get/set ~/.openrm/soul.md directly (not the database). */
export function createSoulRouter(): Router {
  const router = Router();

  router.get("/soul", (_req, res) => {
    const path = getSoulPath();
    const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
    res.json({ content });
  });

  router.put("/soul", (req, res) => {
    const content = typeof req.body?.content === "string" ? req.body.content : undefined;
    if (content === undefined) {
      res.status(400).json({ error: "Missing 'content'." });
      return;
    }
    const home = getOpenrmHome();
    if (!existsSync(home)) mkdirSync(home, { recursive: true });
    writeFileSync(getSoulPath(), content, "utf-8");
    res.json({ ok: true });
  });

  return router;
}
