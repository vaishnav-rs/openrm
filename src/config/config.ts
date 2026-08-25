import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { getConfigPath, getOpenrmHome } from "../setup/paths.js";

/**
 * Shape of ~/.openrm/config.json, written once by the onboarding wizard and
 * read on every `openrm` invocation to decide whether onboarding is needed
 * and to know how to reach Postgres. Provider/model/soul/system-prompt
 * config lives in the database (ProviderConfig/AgentConfig) or in
 * ~/.openrm/soul.md, not here -- this file only holds bootstrap state.
 */
const openrmConfigSchema = z.object({
  databaseUrl: z.string(),
  provisionedViaDocker: z.boolean().default(false),
  onboardedAt: z.string(),
});

export type OpenrmConfig = z.infer<typeof openrmConfigSchema>;

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): OpenrmConfig {
  const raw = readFileSync(getConfigPath(), "utf-8");
  return openrmConfigSchema.parse(JSON.parse(raw));
}

/**
 * Reads ~/.openrm/config.json (if present) and assigns process.env.DATABASE_URL
 * from it, UNLESS the env var is already set (env var wins, matching
 * src/config/env.ts's documented override behavior). Shared by every entry
 * point that needs a live Prisma connection before anything else runs --
 * the foreground CLI (src/cli/index.ts) and the headless server worker
 * (src/server/worker.ts) -- so this "how do we find the database" logic
 * lives in exactly one place.
 */
export function applyConfigToEnv(): void {
  if (!configExists()) return;
  const config = loadConfig();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = config.databaseUrl;
  }
}

export function saveConfig(config: OpenrmConfig): void {
  const home = getOpenrmHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }
  const path = getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
