import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

// The daemon API is unauthenticated by design on the loopback interface, but any local process
// (and CSRF-style browser requests) can still reach it. A per-user bearer token keeps every
// /api/* route closed to callers that cannot read the token file (docs/audit-2026-08-31.md, S1/S2).
export function daemonTokenPath() {
  return process.env.AGENT_DEV_DAEMON_TOKEN_PATH ?? join(homedir(), '.agent-dev', 'daemon-token');
}

/** Loads the persistent daemon token, creating it on first start. Token survives restarts so the
 * Studio dev server and MCP bridge do not need to re-read it after every daemon restart. */
export function loadOrCreateDaemonToken(): string {
  const path = daemonTokenPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return existing;
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

function bearerMatches(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

// Routes that stay reachable without the bearer token. Each needs its own reason:
// - /api/health: liveness probe, no data.
// - /api/github/webhooks: called by GitHub, authenticated by its own HMAC signature check.
// The /events SSE stream is outside /api/* and is exempt because EventSource cannot send headers;
// it only carries delivery event metadata, never credentials.
const TOKEN_EXEMPT_PATHS = new Set(['/api/health', '/api/github/webhooks']);

export function createTokenAuthMiddleware(token: string) {
  return async (context: Context, next: Next) => {
    if (TOKEN_EXEMPT_PATHS.has(context.req.path)) return next();
    const authorization = context.req.header('authorization');
    if (authorization?.startsWith('Bearer ') && bearerMatches(authorization.slice('Bearer '.length), token)) {
      return next();
    }
    return context.json({ error: 'Unauthorized. A valid daemon token is required.' }, 401);
  };
}
