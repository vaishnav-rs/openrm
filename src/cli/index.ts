#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import React from "react";
import { render } from "ink";
import { App, MOUSE_DISABLE_SEQUENCE } from "../tui/App.js";
import { enableSynchronizedOutput } from "../tui/synchronized-output.js";
import { OnboardingWizard } from "./onboarding.js";
import { applyConfigToEnv, configExists, loadConfig } from "../config/config.js";
import {
  getAuthDir,
  getConfigPath,
  getOpenrmHome,
  getServerLogPath,
  getServerPidPath,
  getSoulPath,
} from "../setup/paths.js";
import { startCoreService } from "../core/service.js";
import { disconnectPrisma, getPrisma } from "../db/prisma.js";
import { hashPassword } from "../server/auth.js";

/**
 * Boots WhatsApp connection + message handlers, then renders the Ink
 * dashboard. This is the only place that wires the reactive inbound-message
 * pipeline to a live socket.
 */
async function launchDashboard(options: { fresh?: boolean } = {}): Promise<void> {
  enableSynchronizedOutput(process.stdout);
  applyConfigToEnv();
  await startCoreService(options);
  render(React.createElement(App));
}

async function runOnboardingThenLaunch(): Promise<void> {
  enableSynchronizedOutput(process.stdout);
  await new Promise<void>((resolve) => {
    const { unmount } = render(
      React.createElement(OnboardingWizard, {
        onComplete: () => {
          unmount();
          resolve();
        },
      })
    );
  });
  await launchDashboard();
}

const program = new Command();

program
  .name("openrm")
  .description(
    "A WhatsApp-based CRM agent: pair a WhatsApp number via QR code, and let an " +
      "LLM-powered agent reply to inbound customer messages while saving their " +
      "name, phone number, and interests to Postgres. Never initiates conversations."
  )
  .version("0.1.0");

program
  .command("start", { isDefault: true })
  .description("Start openrm (runs onboarding first if not yet configured)")
  .action(async () => {
    if (!configExists()) {
      await runOnboardingThenLaunch();
    } else {
      await launchDashboard();
    }
  });

program
  .command("init")
  .description("Run (or re-run) the onboarding wizard")
  .action(async () => {
    await runOnboardingThenLaunch();
  });

program
  .command("pair")
  .description("Connect to WhatsApp and show the pairing QR code / dashboard")
  .option(
    "--fresh",
    "clear only the WhatsApp auth session (not config.json or soul.md) and generate a new QR"
  )
  .action(async (opts: { fresh?: boolean }) => {
    if (!configExists()) {
      console.error("openrm has not been set up yet. Run `openrm init` first.");
      process.exitCode = 1;
      return;
    }
    await launchDashboard({ fresh: opts.fresh });
  });

// Every model this app owns, in FK-safe order for a manual delete fallback
// (TRUNCATE ... CASCADE below doesn't actually need this ordering, but it's
// kept as documentation of the full table list wipeAllData() touches).
const ALL_TABLES = [
  "Chunk",
  "Document",
  "Message",
  "Conversation",
  "Interest",
  "Contact",
  "McpServer",
  "ProviderConfig",
  "AgentConfig",
] as const;

/**
 * Permanently deletes every row this app has ever written to the connected
 * database -- contacts, conversations, messages, RAG documents/chunks,
 * provider/agent config, MCP servers. This is deliberately NOT part of the
 * plain `reset` command: reset only ever touches ~/.openrm (local files),
 * because the database is very often something the user provided
 * themselves (an external/managed Postgres they already had), not
 * something this tool spun up -- silently nuking every row in a database
 * the user didn't necessarily expect to be touched at all is a much bigger
 * blast radius than clearing local config/session files, so it needs its
 * own explicit, separately-named opt-in rather than being folded into the
 * default reset flow.
 */
async function wipeAllData(): Promise<void> {
  const prisma = getPrisma();
  const quoted = ALL_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

program
  .command("reset")
  .description("Remove all local openrm state (~/.openrm): config, WhatsApp auth, soul.md")
  .option("--yes", "skip confirmation")
  .option(
    "--wipe-db",
    "ALSO permanently delete every row in the connected database (contacts, conversations, " +
      "messages, RAG documents, provider/agent config, everything) -- irreversible, requires --yes too"
  )
  .action(async (opts: { yes?: boolean; wipeDb?: boolean }) => {
    const home = getOpenrmHome();
    const homeExists = existsSync(home);

    if (opts.wipeDb && !opts.yes) {
      console.log("--wipe-db requires --yes as well (this is irreversible). Nothing was done.");
      return;
    }

    if (!homeExists && !opts.wipeDb) {
      console.log("Nothing to reset -- ~/.openrm does not exist.");
      return;
    }

    if (!opts.yes) {
      console.log(
        `This will delete ${home} (config, WhatsApp auth/session, soul.md). ` +
          "Re-run with --yes to confirm. " +
          "Just need a new QR code? Use `openrm pair --fresh` instead -- it only " +
          "clears the WhatsApp session, leaving config.json and soul.md intact. " +
          "To ALSO permanently wipe every row in the database, add --wipe-db --yes."
      );
      return;
    }

    if (opts.wipeDb) {
      applyConfigToEnv();
      const dbUrl = process.env.DATABASE_URL ?? "(not set)";
      console.log(`Wiping ALL data in: ${dbUrl}`);
      try {
        await wipeAllData();
        console.log("Database wiped: every contact, conversation, message, and document is gone.");
      } catch (err) {
        console.error(
          `Failed to wipe the database: ${err instanceof Error ? err.message : String(err)}`
        );
        console.error("Local files were NOT removed -- fix DATABASE_URL/connectivity and retry.");
        process.exitCode = 1;
        return;
      } finally {
        await disconnectPrisma();
      }
    }

    if (homeExists) {
      rmSync(home, { recursive: true, force: true });
      console.log(`Removed ${home}.`);
    }
  });

program
  .command("status")
  .description("Print current setup status without launching the dashboard")
  .action(() => {
    console.log(`Config file: ${getConfigPath()} -- ${configExists() ? "present" : "missing"}`);
    console.log(`Auth dir: ${getAuthDir()} -- ${existsSync(getAuthDir()) ? "present" : "missing"}`);
    console.log(`Soul file: ${getSoulPath()} -- ${existsSync(getSoulPath()) ? "present" : "missing"}`);
    if (configExists()) {
      const config = loadConfig();
      console.log(`Onboarded at: ${config.onboardedAt}`);
      console.log(`Provisioned via Docker: ${config.provisionedViaDocker}`);
    }
  });

// --------------------------------------------------------------------------
// `openrm server start|stop|status` -- a headless background daemon mode.
// See src/server/worker.ts for what the spawned child process actually
// does; this section is purely the parent-process orchestration (spawn,
// PID file, health polling).
// --------------------------------------------------------------------------

interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
}

function readServerState(): ServerState | undefined {
  try {
    const raw = readFileSync(getServerPidPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number" && typeof parsed?.port === "number") {
      return parsed as ServerState;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** process.kill(pid, 0) sends no signal -- it only tests whether the process exists/is signalable. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeStaleServerState(): void {
  rmSync(getServerPidPath(), { force: true });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // Not up yet -- keep polling.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function promptLine(question: string): Promise<string> {
  // Plain readline, no input masking -- this is a one-time interactive CLI
  // moment (the first `openrm server start` with no password configured
  // yet), not a persistent TUI screen, so the added complexity of muting
  // the terminal for asterisk-masking wasn't judged worth it here. Simple
  // and correct beats a half-implemented masking hack.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Ensures AgentConfig.authPasswordHash/Salt are set before the server is
 * ever allowed to start, prompting interactively in the terminal if not.
 * Runs in the FOREGROUND `openrm server start` CLI process (before the
 * detached worker is even spawned) -- never in the headless worker itself,
 * which has no terminal to prompt on (see src/server/worker.ts's own
 * refusal-to-start check for that case, e.g. `openrm server start` was
 * previously run once successfully but the DB got wiped since).
 */
async function ensureServerPassword(): Promise<void> {
  const prisma = getPrisma();
  const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
  if (config?.authPasswordHash && config.authPasswordSalt) return;

  console.log("No admin password is configured yet for the openrm web/API server.");
  let password = "";
  while (!password) {
    password = (await promptLine("Set an admin password for the web UI/API: ")).trim();
    if (!password) console.log("Password cannot be empty.");
  }
  const confirm = await promptLine("Confirm password: ");
  if (confirm.trim() !== password) {
    console.error("Passwords did not match. Aborting.");
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  await prisma.agentConfig.upsert({
    where: { id: "1" },
    update: { authPasswordHash: hash, authPasswordSalt: salt },
    create: { id: "1", masterSystemPrompt: "", authPasswordHash: hash, authPasswordSalt: salt },
  });
  console.log("Admin password saved.");
}

const server = program.command("server").description("Run openrm as a headless background daemon with a REST/WS API");

server
  .command("start")
  .description("Start the openrm server in the background")
  .option("--port <n>", "port to listen on", "4173")
  .action(async (opts: { port: string }) => {
    if (!configExists()) {
      console.error("openrm has not been set up yet. Run `openrm init` first.");
      process.exitCode = 1;
      return;
    }

    const existing = readServerState();
    if (existing && isPidAlive(existing.pid)) {
      console.log(
        `A server is already running (pid ${existing.pid}, port ${existing.port}) -- ` +
          `http://localhost:${existing.port}. Run \`openrm server stop\` first if you want to restart it.`
      );
      return;
    } else if (existing) {
      console.log("Found a stale server.pid from a previous crash -- cleaning it up.");
      removeStaleServerState();
    }

    const port = Number(opts.port);
    if (!Number.isInteger(port) || port <= 0) {
      console.error(`Invalid --port: ${opts.port}`);
      process.exitCode = 1;
      return;
    }

    applyConfigToEnv();
    await ensureServerPassword();
    // The worker process makes its own PrismaClient; disconnect this one so
    // the foreground process doesn't hold a connection open needlessly
    // while it polls for health below.
    await disconnectPrisma();

    const home = getOpenrmHome();
    if (!existsSync(home)) mkdirSync(home, { recursive: true });
    const logFd = openSync(getServerLogPath(), "a");

    const nodeBin = process.execPath;
    const scriptPath = process.argv[1]; // this same compiled CLI entrypoint
    const child = spawn(nodeBin, [scriptPath, "__server-worker", "--port", String(port)], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    child.unref();

    console.log(`Starting openrm server (pid ${child.pid}) on port ${port}...`);
    const healthy = await waitForHealth(port, 15000);
    if (!healthy) {
      console.error(
        `Server did not report healthy within 15s -- check ${getServerLogPath()} for details. ` +
          `It may still come up; run \`openrm server status\` shortly.`
      );
      process.exitCode = 1;
      return;
    }

    console.log(`openrm server is up: http://localhost:${port}`);
  });

server
  .command("stop")
  .description("Stop the background openrm server")
  .action(async () => {
    const state = readServerState();
    if (!state) {
      console.log("No server is running (no server.pid found).");
      return;
    }
    if (!isPidAlive(state.pid)) {
      console.log("server.pid refers to a process that is no longer running -- cleaning up the stale file.");
      removeStaleServerState();
      return;
    }

    console.log(`Stopping openrm server (pid ${state.pid})...`);
    process.kill(state.pid, "SIGTERM");

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && isPidAlive(state.pid)) {
      await new Promise((r) => setTimeout(r, 300));
    }

    if (isPidAlive(state.pid)) {
      console.error(
        `Process ${state.pid} did not exit within 10s after SIGTERM. It may need to be killed manually.`
      );
      process.exitCode = 1;
      return;
    }

    // The worker itself removes server.pid on graceful shutdown, but clean
    // up defensively in case it was killed before reaching that point.
    removeStaleServerState();
    console.log("openrm server stopped.");
  });

server
  .command("status")
  .description("Report whether the background openrm server is running")
  .action(async () => {
    const state = readServerState();
    if (!state || !isPidAlive(state.pid)) {
      if (state) {
        console.log("server.pid refers to a process that is no longer running -- cleaning up the stale file.");
        removeStaleServerState();
      }
      console.log("openrm server: not running.");
      return;
    }

    console.log(`openrm server: running (pid ${state.pid}, started ${state.startedAt})`);
    console.log(`URL: http://localhost:${state.port}`);
    try {
      const res = await fetch(`http://localhost:${state.port}/api/health`);
      const body = (await res.json()) as { waStatus?: string; uptimeSeconds?: number };
      console.log(`WhatsApp status: ${body.waStatus}`);
      console.log(`Uptime: ${body.uptimeSeconds}s`);
    } catch (err) {
      console.log(
        `Process is alive but /api/health did not respond (${
          err instanceof Error ? err.message : String(err)
        }) -- it may still be starting up.`
      );
    }
  });

// Hidden internal entrypoint, only ever invoked by `server start` above via
// a detached child_process.spawn -- never meant to be run directly by a
// user. Actually starts the core service + HTTP/WS server in THIS process.
program
  .command("__server-worker", { hidden: true })
  .option("--port <n>", "port to listen on", "4173")
  .action(async (opts: { port: string }) => {
    applyConfigToEnv();
    const { runServerWorker } = await import("../server/worker.js");
    await runServerWorker(Number(opts.port));
  });

process.on("SIGINT", async () => {
  // Make sure SGR mouse reporting is never left enabled in the user's
  // terminal after openrm exits (see src/tui/App.tsx for why this must be
  // disabled promptly).
  process.stdout.write(MOUSE_DISABLE_SEQUENCE);
  await disconnectPrisma();
  process.exit(0);
});

await program.parseAsync(process.argv);
