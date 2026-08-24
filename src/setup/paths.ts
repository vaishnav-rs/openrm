import { homedir } from "node:os";
import { join } from "node:path";

/**
 * All openrm state lives under ~/.openrm, cross-platform via os.homedir().
 */
export function getOpenrmHome(): string {
  return join(homedir(), ".openrm");
}

export function getConfigPath(): string {
  return join(getOpenrmHome(), "config.json");
}

export function getSoulPath(): string {
  return join(getOpenrmHome(), "soul.md");
}

export function getAuthDir(): string {
  return join(getOpenrmHome(), "auth");
}

export function getDockerComposePath(): string {
  return join(getOpenrmHome(), "docker-compose.yml");
}
