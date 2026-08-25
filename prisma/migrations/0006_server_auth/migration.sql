-- Adds web/API server auth fields to AgentConfig (see src/server/).
--
-- openrm server start uses a single admin password, hashed with Node's
-- built-in crypto.scryptSync (no bcrypt dependency) -- authPasswordHash and
-- authPasswordSalt are hex-encoded scrypt output/salt. Both null until the
-- interactive first-run password prompt (src/cli/index.ts) sets them; the
-- server refuses to start with no password configured.
--
-- sessionSecret is an HMAC secret generated once (crypto.randomBytes) and
-- persisted here so that restarting the server does not invalidate every
-- existing browser session cookie. Session state itself (which cookies are
-- currently valid) is tracked in-memory only, in the running server
-- process -- this column only lets the server verify a presented cookie was
-- really signed by it.

-- AlterTable
ALTER TABLE "AgentConfig" ADD COLUMN "authPasswordHash" TEXT;
ALTER TABLE "AgentConfig" ADD COLUMN "authPasswordSalt" TEXT;
ALTER TABLE "AgentConfig" ADD COLUMN "sessionSecret" TEXT;
