import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from './app.js';
import { DaemonEventBus } from './events.js';

export type StartDaemonOptions = {
  port?: number;
  databasePath?: string;
};

// The database must resolve to the same file whether the daemon is launched from the repository root
// or through `npm run -w @agent-dev/daemon dev`, which sets cwd to the package directory. Anchoring on
// cwd created two separate databases and silently split project state between them.
export function resolveWorkspaceRoot(startDirectory: string): string {
  const { root } = parse(startDirectory);
  let current = startDirectory;
  while (true) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { workspaces?: unknown };
        if (manifest.workspaces !== undefined) return current;
      } catch {
        // An unreadable manifest is not the root we are looking for; keep walking up.
      }
    }
    if (current === root) return startDirectory;
    current = dirname(current);
  }
}

export async function startDaemon(options: StartDaemonOptions = {}) {
  const port = options.port ?? Number(process.env.AGENT_DEV_PORT ?? 3737);
  const databasePath =
    options.databasePath ??
    process.env.AGENT_DEV_DATABASE_PATH ??
    join(resolveWorkspaceRoot(process.cwd()), '.agent-dev', 'agent-dev.sqlite');
  const dataDirectory = dirname(databasePath);
  const store = await AgentDevStore.open(databasePath);
  const { app, events } = createDaemonApp(store, new DaemonEventBus(), {}, dataDirectory);
  const server = serve({ fetch: app.fetch, port });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });

  return {
    app,
    events,
    port,
    databasePath,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      await store.close();
    },
  };
}
