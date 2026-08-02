import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from './app.js';

export type StartDaemonOptions = {
  port?: number;
  databasePath?: string;
};

export async function startDaemon(options: StartDaemonOptions = {}) {
  const port = options.port ?? 3737;
  const databasePath = options.databasePath ?? join(process.cwd(), '.agent-dev', 'agent-dev.sqlite');
  const store = await AgentDevStore.open(databasePath);
  const { app, events } = createDaemonApp(store);
  const server = serve({ fetch: app.fetch, port });

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
