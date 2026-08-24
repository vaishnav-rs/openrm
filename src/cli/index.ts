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
import { disconnectPrisma } from "../db/prisma.js";

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

program
  .command("reset")
  .description("Remove all local openrm state (~/.openrm): config, WhatsApp auth, soul.md")
  .option("--yes", "skip confirmation")
  .action(async (opts: { yes?: boolean }) => {
    const home = getOpenrmHome();
    if (!existsSync(home)) {
      console.log("Nothing to reset -- ~/.openrm does not exist.");
      return;
    }
    if (!opts.yes) {
      console.log(
        `This will delete ${home} (config, WhatsApp auth/session, soul.md). ` +
          "Re-run with --yes to confirm. " +
          "Just need a new QR code? Use `openrm pair --fresh` instead -- it only " +
          "clears the WhatsApp session, leaving config.json and soul.md intact."
      );
      return;
    }
    rmSync(home, { recursive: true, force: true });
    console.log(`Removed ${home}.`);
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
