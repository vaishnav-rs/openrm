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

/**
 * Persistent log file for WhatsApp connection/pairing events (connection
 * closes with their real disconnect reason, QR generation, successful
 * connects). Survives the TUI being closed, so a failed pairing attempt can
 * be diagnosed from real data instead of guessing -- see src/whatsapp/client.ts.
 */
export function getLogPath(): string {
  return join(getOpenrmHome(), "openrm.log");
}
