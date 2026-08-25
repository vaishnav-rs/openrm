import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getPrisma } from "../db/prisma.js";

const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE_NAME = "openrm_session";
// Sessions are tracked purely in-memory (a Map in this running daemon
// process) -- see the module doc comment on AgentConfig.sessionSecret in
// prisma/schema.prisma for why that's sufficient for a single long-running
// process with no persistent session store. A restart of the server (or of
// `openrm server start`) invalidates every session, requiring re-login;
// that's an accepted tradeoff for staying simple, since this is a
// single-admin-password local/self-hosted tool, not a multi-user SaaS.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionRecord {
  createdAt: number;
}

const sessions = new Map<string, SessionRecord>();

/**
 * Hashes `password` with Node's built-in crypto.scryptSync (deliberately no
 * bcrypt dependency -- see the top-level task constraints). Returns
 * hex-encoded salt + hash, both stored on AgentConfig (see migration
 * 0006_server_auth).
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

/** Timing-safe verification of `password` against a stored hash+salt pair. */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Generates a fresh hex-encoded HMAC secret, for AgentConfig.sessionSecret. */
export function generateSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Loads (or lazily creates and persists) the session-signing secret from
 * AgentConfig. Generated once and persisted so a server restart does not
 * regenerate it and invalidate every issued cookie's *signature* -- though
 * note the in-memory `sessions` Map above is still wiped on restart either
 * way, so existing sessions still need to re-login after a restart; this
 * only means a cookie value itself always verifies against the same secret
 * rather than a new random one.
 */
export async function getOrCreateSessionSecret(): Promise<string> {
  const prisma = getPrisma();
  const existing = await prisma.agentConfig.findUnique({ where: { id: "1" } });
  if (existing?.sessionSecret) return existing.sessionSecret;

  const secret = generateSessionSecret();
  await prisma.agentConfig.upsert({
    where: { id: "1" },
    update: { sessionSecret: secret },
    create: { id: "1", masterSystemPrompt: "", sessionSecret: secret },
  });
  return secret;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Creates a new in-memory session and returns its signed cookie value. */
export function createSession(secret: string): string {
  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now() });
  return `${token}.${sign(token, secret)}`;
}

/** Removes a session (logout), tolerant of an already-invalid cookie value. */
export function destroySession(cookieValue: string | undefined): void {
  if (!cookieValue) return;
  const [token] = cookieValue.split(".");
  if (token) sessions.delete(token);
}

/**
 * Verifies a signed cookie value against `secret` and that the referenced
 * session both exists and hasn't expired (evicting it if it has).
 */
export function verifySession(cookieValue: string | undefined, secret: string): boolean {
  if (!cookieValue) return false;
  const [token, signature] = cookieValue.split(".");
  if (!token || !signature) return false;

  const expected = sign(token, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const record = sessions.get(token);
  if (!record) return false;
  if (Date.now() - record.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Minimal manual Cookie-header parser -- avoids pulling in cookie-parser for one name. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getSessionCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

/**
 * Sets the session cookie. httpOnly + sameSite=strict always; `secure` is
 * deliberately NOT hard-required -- this server defaults to plain HTTP on
 * localhost (no TLS setup exists for a self-hosted CLI daemon), and a
 * `secure` cookie would silently never be sent back over that connection,
 * breaking login. If a deployment puts this behind HTTPS/a reverse proxy,
 * the cookie still works (browsers accept non-secure cookies over HTTPS
 * too) -- it's just not upgraded to secure-only automatically. Documented
 * tradeoff per the task spec.
 */
export function setSessionCookie(res: Response, value: string): void {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/**
 * Express middleware requiring a valid session cookie. Mounted on every
 * route except POST /api/auth/login and GET /api/health (see
 * src/server/app.ts for where those are excluded).
 */
export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cookie = getSessionCookie(req);
    if (!verifySession(cookie, secret)) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    next();
  };
}

/**
 * Verifies a raw WebSocket upgrade request's session cookie (no Express
 * req/res available at that layer) -- used by src/server/ws.ts's upgrade
 * handler.
 */
export function verifySessionFromCookieHeader(cookieHeader: string | undefined, secret: string): boolean {
  const cookie = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  return verifySession(cookie, secret);
}
