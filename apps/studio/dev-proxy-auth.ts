import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The daemon requires `Authorization: Bearer <token>` on every /api/* route
// (docs/audit-2026-08-31.md §6.1-2). The Studio dev server attaches that header inside its /api
// proxy instead of handing the token to the browser, for two reasons found while walking the Studio
// flow on a clean machine:
//
// 1. Cold start. A value injected through vite `define` is captured once when the config is
//    loaded, but `npm run dev` starts the daemon concurrently and the daemon only creates
//    ~/.agent-dev/daemon-token on its first start. The browser then keeps an empty token for the
//    whole session and every /api/* call answers 401. Reading per request converges as soon as the
//    daemon is up, with no restart and no ordering requirement on the user.
// 2. Exposure. Vite serves dev modules with inline source maps on an unauthenticated port, so a
//    token baked into `define` is readable by any local process and lands in build artifacts too.
//    Keeping it server-side removes both surfaces.

export function daemonTokenPath(): string {
  return process.env.AGENT_DEV_DAEMON_TOKEN_PATH ?? join(homedir(), '.agent-dev', 'daemon-token');
}

/** Reads the current token, or an empty string when the daemon has not created it yet. */
export function readDaemonToken(path = daemonTokenPath()): string {
  if (!existsSync(path)) return '';
  // The daemon writes a trailing newline; an untrimmed token fails the bearer comparison.
  return readFileSync(path, 'utf8').trim();
}

/**
 * Minimal shape of the http-proxy `proxyReq` argument, declared here so this module does not need
 * to resolve Vite's bundled proxy types (which are a transitive `@types/http-proxy` dependency).
 */
export type ProxyRequestLike = {
  setHeader(name: string, value: string): void;
};

/**
 * An http-proxy `proxyReq` listener that presents the daemon token. The token is read for every
 * request, never captured at module load.
 */
export function createDaemonAuthHandler(
  readToken: () => string = readDaemonToken,
): (proxyRequest: ProxyRequestLike) => void {
  return proxyRequest => {
    const token = readToken();
    // Absent token means absent header: the daemon replies with its own "A valid daemon token is
    // required" 401 rather than seeing a silently empty bearer credential.
    if (token) proxyRequest.setHeader('authorization', `Bearer ${token}`);
  };
}
