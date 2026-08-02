import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { createDefaultBlueprint } from '@agent-dev/blueprint';
import { AgentDevStore } from '@agent-dev/storage';
import { DaemonEventBus } from './events.js';

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export function createDaemonApp(store: AgentDevStore, events = new DaemonEventBus()) {
  const app = new Hono();

  app.use('*', cors({ origin: 'http://localhost:5173' }));

  app.get('/api/health', context =>
    context.json({ service: 'agent-dev-daemon', status: 'ok', version: '0.1.0-alpha.0' }),
  );

  app.get('/api/projects', context => context.json({ projects: store.listProjects() }));

  app.get('/api/projects/:projectId', context => {
    const project = store.getProject(context.req.param('projectId'));
    return project ? context.json({ project }) : context.json({ error: 'Project not found.' }, 404);
  });

  app.post('/api/projects', async context => {
    const parsed = createProjectSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json({ error: 'A project name between 2 and 80 characters is required.' }, 400);
    }

    const project = await store.createProject({
      name: parsed.data.name,
      blueprint: createDefaultBlueprint(parsed.data.name),
    });
    events.emit({
      type: 'project.created',
      projectId: project.id,
      projectName: project.name,
      occurredAt: new Date().toISOString(),
    });
    return context.json({ project }, 201);
  });

  app.get('/events', context =>
    streamSSE(context, async stream => {
      const unsubscribe = events.subscribe(event => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(unsubscribe);
      await new Promise<void>(resolve => stream.onAbort(resolve));
    }),
  );

  return { app, events };
}
