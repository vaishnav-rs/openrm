#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, rmSync } from "node:fs";
import React from "react";
import { render } from "ink";
import { App, MOUSE_DISABLE_SEQUENCE } from "../tui/App.js";
import { enableSynchronizedOutput } from "../tui/synchronized-output.js";
import { OnboardingWizard } from "./onboarding.js";
import { configExists, loadConfig } from "../config/config.js";
import { getAuthDir, getConfigPath, getOpenrmHome, getSoulPath } from "../setup/paths.js";
import { connect, reconnectFresh } from "../whatsapp/client.js";
import { registerMessageHandlers } from "../whatsapp/handlers.js";
import { disconnectPrisma, getPrisma } from "../db/prisma.js";

function applyConfigToEnv(): void {
  if (!configExists()) return;
  const config = loadConfig();
  // Env var wins if already set (matches src/config/env.ts's documented
  // override behavior); otherwise fall back to the onboarding-time value.
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = config.databaseUrl;
  }
}

/**
 * Boots WhatsApp connection + message handlers, then renders the Ink
 * dashboard. This is the only place that wires the reactive inbound-message
 * pipeline to a live socket.
 */
async function launchDashboard(options: { fresh?: boolean } = {}): Promise<void> {
  enableSynchronizedOutput(process.stdout);
  applyConfigToEnv();
  const sock = options.fresh ? await reconnectFresh() : await connect();
  registerMessageHandlers(sock);
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

process.on("SIGINT", async () => {
  // Make sure SGR mouse reporting is never left enabled in the user's
  // terminal after openrm exits (see src/tui/App.tsx for why this must be
  // disabled promptly).
  process.stdout.write(MOUSE_DISABLE_SEQUENCE);
  await disconnectPrisma();
  process.exit(0);
});

await program.parseAsync(process.argv);
