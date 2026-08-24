import { PrismaClient } from "@prisma/client";

/**
 * Singleton PrismaClient. DATABASE_URL should be set in process.env before
 * this module is first imported (the CLI entrypoint does this by reading
 * ~/.openrm/config.json and assigning process.env.DATABASE_URL, unless the
 * env var is already set, in which case that value wins).
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
  }
}
