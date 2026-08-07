import { serve } from '@hono/node-server';
import { join, dirname } from 'node:path';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from './app.js';
import { DaemonEventBus } from './events.js';

export type StartDaemonOptions = {
  port?: number;
  databasePath?: string;
};

export async function startDaemon(options: StartDaemonOptions = {}) {
  const port = options.port ?? 3737;
  const databasePath = options.databasePath ?? join(process.cwd(), '.agent-dev', 'agent-dev.sqlite');
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
