import { z } from "zod";

/**
 * openrm is configured mainly through ~/.openrm/config.json (written by the
 * onboarding wizard), not environment variables. The only env var honored is
 * DATABASE_URL, which -- when present -- overrides whatever is stored in the
 * config file, matching standard Prisma / 12-factor convention.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Env vars here are all optional; a parse failure means a malformed
    // DATABASE_URL was supplied. Fail loudly since a silently-ignored bad
    // DATABASE_URL is worse than a clear error.
    throw new Error(
      `Invalid environment variables: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}
