import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDockerComposePath, getOpenrmHome } from "./paths.js";

/**
 * Library code only -- these functions are called by the onboarding wizard
 * at the END USER's runtime, on the end user's machine. Nothing in this
 * repo's build/test process invokes them.
 */

function run(command: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`${command} ${args.join(" ")} timed out`));
        }, opts.timeoutMs)
      : undefined;
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await run("docker", ["version"], { timeoutMs: 5000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function isDockerComposeAvailable(): Promise<boolean> {
  try {
    const result = await run("docker", ["compose", "version"], { timeoutMs: 5000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

function findTemplatesDir(): string {
  // dist/setup/docker-detect.js -> ../../templates when installed as a package
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates"),
    join(here, "..", "..", "..", "templates"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "docker-compose.yml"))) return c;
  }
  return candidates[0];
}

/**
 * Copies templates/docker-compose.yml into ~/.openrm/ and brings up the
 * `postgres` service via `docker compose up -d postgres`, then polls until
 * the container reports healthy. Only called from the onboarding wizard at
 * end-user runtime -- never executed as part of building this package.
 */
export async function provisionPostgresViaDocker(
  onProgress?: (message: string) => void
): Promise<{ databaseUrl: string }> {
  const home = getOpenrmHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }

  const templatesDir = findTemplatesDir();
  const source = join(templatesDir, "docker-compose.yml");
  const dest = getDockerComposePath();
  copyFileSync(source, dest);

  onProgress?.("Starting Postgres (pgvector) via docker compose...");
  const up = await run("docker", ["compose", "-f", dest, "up", "-d", "postgres"], {
    timeoutMs: 120_000,
  });
  if (up.code !== 0) {
    throw new Error(`docker compose up failed: ${up.stderr || up.stdout}`);
  }

  onProgress?.("Waiting for Postgres to become healthy...");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const inspect = await run("docker", [
      "compose",
      "-f",
      dest,
      "ps",
      "--format",
      "json",
      "postgres",
    ]);
    if (inspect.stdout.includes('"Health":"healthy"') || inspect.stdout.includes("healthy")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const databaseUrl = "postgresql://openrm:openrm@localhost:5432/openrm?schema=public";
  return { databaseUrl };
}
