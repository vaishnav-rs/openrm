import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getPrisma } from "../../db/prisma.js";
import { instantiateProvider } from "../../providers/registry.js";
import { KNOWN_OLLAMA_EMBEDDING_MODELS, pullOllamaModel } from "../../providers/ollama-pull.js";
import { broadcast } from "../ws.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Mirrors src/tui/screens/Providers.tsx: CRUD, activate, test connection,
 * and the embedding-model picker (reuses KNOWN_OLLAMA_EMBEDDING_MODELS and
 * pullOllamaModel from src/providers/ollama-pull.ts directly, same as the
 * TUI does -- no reimplementation of the pull/streaming logic).
 */
export function createProvidersRouter(): Router {
  const router = Router();

  router.get("/providers", async (_req, res) => {
    const prisma = getPrisma();
    const rows = await prisma.providerConfig.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ providers: rows });
  });

  router.post("/providers", async (req, res) => {
    const { name, apiKey, baseUrl, model, embeddingModel } = req.body ?? {};
    if (typeof name !== "string" || typeof model !== "string") {
      res.status(400).json({ error: "Missing required fields 'name'/'model'." });
      return;
    }
    const prisma = getPrisma();
    const row = await prisma.providerConfig.create({
      data: {
        name,
        apiKey: apiKey || null,
        baseUrl: baseUrl || null,
        model,
        embeddingModel: embeddingModel || null,
        isActive: false,
      },
    });
    res.status(201).json({ provider: row });
  });

  router.patch("/providers/:id", async (req, res) => {
    const { apiKey, baseUrl, model, embeddingModel } = req.body ?? {};
    const prisma = getPrisma();
    try {
      const row = await prisma.providerConfig.update({
        where: { id: req.params.id },
        data: {
          ...(apiKey !== undefined ? { apiKey: apiKey || null } : {}),
          ...(baseUrl !== undefined ? { baseUrl: baseUrl || null } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(embeddingModel !== undefined ? { embeddingModel: embeddingModel || null } : {}),
        },
      });
      res.json({ provider: row });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/providers/:id", async (req, res) => {
    const prisma = getPrisma();
    try {
      await prisma.providerConfig.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/providers/:id/activate", async (req, res) => {
    const prisma = getPrisma();
    try {
      await prisma.$transaction([
        prisma.providerConfig.updateMany({ data: { isActive: false }, where: {} }),
        prisma.providerConfig.update({ where: { id: req.params.id }, data: { isActive: true } }),
      ]);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/providers/:id/test", async (req, res) => {
    const prisma = getPrisma();
    const row = await prisma.providerConfig.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: "Provider not found." });
      return;
    }
    try {
      const provider = instantiateProvider({
        name: row.name,
        apiKey: row.apiKey ?? undefined,
        baseUrl: row.baseUrl ?? undefined,
        model: row.model,
        embeddingModel: row.embeddingModel ?? undefined,
      });
      const result = await provider.chat([{ role: "user", content: "Reply with the single word OK." }], []);
      res.json({ ok: true, message: `model responded: ${(result.content ?? "").slice(0, 200)}` });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Static, curated list -- same data the TUI's picker shows.
  router.get("/providers/embedding-models", (_req, res) => {
    res.json({ models: KNOWN_OLLAMA_EMBEDDING_MODELS });
  });

  // Triggers an Ollama model pull with progress streamed over WebSocket as
  // "embedding:pull-progress"/"embedding:pull-done" events (see
  // src/server/ws.ts), keyed by the requestId returned here so a client can
  // match progress frames to this specific request. Reuses pullOllamaModel
  // directly -- does not reimplement Ollama's NDJSON pull protocol.
  router.post("/providers/:id/pull-embedding-model", async (req, res) => {
    const modelName = typeof req.body?.model === "string" ? req.body.model : "";
    if (!modelName) {
      res.status(400).json({ error: "Missing 'model'." });
      return;
    }
    const prisma = getPrisma();
    const row = await prisma.providerConfig.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: "Provider not found." });
      return;
    }

    const requestId = randomUUID();
    res.status(202).json({ ok: true, requestId });

    const baseUrl = row.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
    try {
      await pullOllamaModel(modelName, baseUrl, (p) => {
        broadcast({
          type: "embedding:pull-progress",
          payload: { requestId, status: p.status, completed: p.completed, total: p.total },
        });
      });
      await prisma.providerConfig.update({ where: { id: row.id }, data: { embeddingModel: modelName } });
      broadcast({ type: "embedding:pull-done", payload: { requestId, ok: true } });
    } catch (err) {
      broadcast({
        type: "embedding:pull-done",
        payload: { requestId, ok: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  return router;
}
