import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { deleteDocument, ingestFile, listDocuments } from "../../rag/ingest.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * Mirrors src/tui/screens/RagDocuments.tsx: list, upload, delete. Upload
 * writes the incoming multipart file to a temp path, then hands off to the
 * EXISTING ingestFile() from src/rag/ingest.ts (chunking + embedding +
 * Document/Chunk persistence) -- this route does none of that itself.
 */
export function createRagRouter(): Router {
  const router = Router();

  router.get("/rag/documents", async (_req, res) => {
    const docs = await listDocuments();
    res.json({ documents: docs });
  });

  router.post("/rag/documents", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing multipart field 'file'." });
      return;
    }

    const dir = join(tmpdir(), "openrm-uploads");
    mkdirSync(dir, { recursive: true });
    const tempPath = join(dir, `${randomUUID()}-${file.originalname}`);
    writeFileSync(tempPath, file.buffer);

    try {
      const result = await ingestFile(tempPath);
      res.status(201).json({ ok: true, document: result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      // The temp upload is only needed for ingestFile's own readFileSync
      // call; once ingestion is done (success or failure) its content is
      // either persisted as Chunk rows or not needed at all, so it's
      // deleted rather than left to accumulate in the OS temp dir. Document.sourcePath
      // will point at this now-deleted temp path -- acceptable for an
      // upload flow (unlike the TUI's ingest, which points at a real,
      // stable user file).
      rmSync(tempPath, { force: true });
    }
  });

  router.delete("/rag/documents/:id", async (req, res) => {
    try {
      await deleteDocument(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
