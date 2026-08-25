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

/**
 * PID/port/startedAt state file for a background `openrm server start`
 * daemon (see src/cli/index.ts's `server` command group). Written by the
 * detached child process once its HTTP server is confirmed listening;
 * `openrm server stop`/`status` read it to find and signal that process.
 * Holds JSON: {pid: number, port: number, startedAt: string}.
 */
export function getServerPidPath(): string {
  return join(getOpenrmHome(), "server.pid");
}

/**
 * Append-only stdout/stderr log for the detached `openrm server start`
 * background process -- it has no controlling terminal, so this is the only
 * place its output (including any crash before the HTTP server comes up)
 * can be seen.
 */
export function getServerLogPath(): string {
  return join(getOpenrmHome(), "server.log");
}
