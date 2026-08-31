import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The daemon requires `Authorization: Bearer <token>` on every /api/* route
// (docs/audit-2026-08-31.md §6.1-2). The token lives outside the repo, next to the daemon's other
// user-level state; reading it here lets the browser side attach it without a per-request setup.
// The token is persistent, so reading it once at dev-server start is stable across daemon restarts.
const daemonTokenPath = process.env.AGENT_DEV_DAEMON_TOKEN_PATH ?? join(homedir(), '.agent-dev', 'daemon-token');
const daemonToken = existsSync(daemonTokenPath) ? readFileSync(daemonTokenPath, 'utf8').trim() : '';

export default defineConfig({
  plugins: [react()],
  define: {
    __DAEMON_TOKEN__: JSON.stringify(daemonToken),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3737',
      '/events': 'http://localhost:3737',
    },
  },
});
