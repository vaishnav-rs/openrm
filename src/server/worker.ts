import { createServer } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { applyConfigToEnv, configExists } from "../config/config.js";
import { disconnectPrisma, getPrisma } from "../db/prisma.js";
import { getServerPidPath } from "../setup/paths.js";
import { startCoreService } from "../core/service.js";
import { getOrCreateSessionSecret } from "./auth.js";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./ws.js";

/**
 * Entry point for the headless `openrm __server-worker --port <n>` process
 * (hidden CLI command, see src/cli/index.ts's `server start`, which spawns
 * this detached and never invokes it directly itself). Boots the core
 * WhatsApp service with NO Ink rendering, then the HTTP/WS API on top of it.
 */
export async function runServerWorker(port: number): Promise<void> {
  if (!configExists()) {
    console.error("openrm has not been set up yet. Run `openrm init` first.");
    process.exit(1);
  }
  applyConfigToEnv();

  const prisma = getPrisma();
  const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
  if (!config?.authPasswordHash || !config.authPasswordSalt) {
    console.error(
      "No admin password is configured. Run `openrm server start` from an interactive " +
        "terminal once to set one before it can run in the background."
    );
    process.exit(1);
  }

  const sessionSecret = await getOrCreateSessionSecret();

  // Core service: WhatsApp connection + reactive message handling, with
  // zero Ink/TUI involvement -- see src/core/service.ts.
  await startCoreService();

  const app = createApp(sessionSecret);
  const httpServer = createServer(app);
  attachWebSocketServer(httpServer, sessionSecret);

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  writeFileSync(
    getServerPidPath(),
    JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
  console.log(`openrm server listening on http://localhost:${port} (pid ${process.pid})`);

  async function shutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}, shutting down...`);
    try {
      rmSync(getServerPidPath(), { force: true });
    } catch {
      // Best-effort cleanup -- `openrm server stop` also tolerates a
      // missing/stale pid file, so this is not fatal either way.
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await disconnectPrisma();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
