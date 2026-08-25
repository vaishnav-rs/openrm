import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { requireAuth } from "./auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter, createStatusRouter } from "./routes/status.js";
import { createPairingRouter } from "./routes/pairing.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { createContactsRouter } from "./routes/contacts.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createSoulRouter } from "./routes/soul.js";
import { createSystemPromptRouter } from "./routes/systemPrompt.js";
import { createRagRouter } from "./routes/rag.js";
import { createMcpRouter } from "./routes/mcp.js";

/** Same package-root discovery pattern as src/cli/onboarding.tsx's findPackageRoot(). */
function findPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", ".."), join(here, "..", "..", "..")];
  for (const c of candidates) {
    if (existsSync(join(c, "prisma", "schema.prisma"))) return c;
  }
  return candidates[0];
}

function loadPlaceholderHtml(): string {
  const root = findPackageRoot();
  const path = join(root, "templates", "web-placeholder.html");
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return "<!doctype html><title>openrm</title><p>openrm server is running. API is live at /api.</p>";
}

/**
 * Builds the Express app: session auth middleware on every /api route
 * except /api/auth/login and /api/health, every REST route (see
 * src/server/routes/*), and the minimal static placeholder at `/` (Phase 2
 * replaces this with the real frontend build output).
 */
export function createApp(sessionSecret: string): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const authRouter = createAuthRouter(sessionSecret);
  const healthRouter = createHealthRouter();

  // Unauthenticated: login (obviously) and health (so `openrm server
  // status`, running as a separate CLI process with no session, can query
  // it -- see the task spec's explicit requirement for this).
  app.use("/api/auth", authRouter);
  app.use("/api", healthRouter);

  // Everything else under /api requires a valid session.
  app.use("/api", requireAuth(sessionSecret));
  app.use("/api", createStatusRouter());
  app.use("/api", createPairingRouter());
  app.use("/api", createConversationsRouter());
  app.use("/api", createContactsRouter());
  app.use("/api", createProvidersRouter());
  app.use("/api", createSoulRouter());
  app.use("/api", createSystemPromptRouter());
  app.use("/api", createRagRouter());
  app.use("/api", createMcpRouter());

  const placeholderHtml = loadPlaceholderHtml();
  app.get("/", (_req, res) => {
    res.type("html").send(placeholderHtml);
  });

  return app;
}
