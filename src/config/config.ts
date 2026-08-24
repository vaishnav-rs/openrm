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
