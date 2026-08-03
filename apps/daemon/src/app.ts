import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { blueprintAnswersSchema, createBlueprint, getBlueprintDecisions } from '@agent-dev/blueprint';
import { AgentDevStore } from '@agent-dev/storage';
import { DaemonEventBus } from './events.js';

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  answers: blueprintAnswersSchema.optional(),
});

const reviseBlueprintSchema = z.object({
  answers: blueprintAnswersSchema,
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
      blueprint: createBlueprint(parsed.data.name, parsed.data.answers),
    });
    events.emit({
      type: 'project.created',
      projectId: project.id,
      projectName: project.name,
      occurredAt: new Date().toISOString(),
    });
    return context.json({ project }, 201);
  });

  app.put('/api/projects/:projectId/blueprint', async context => {
    const projectId = context.req.param('projectId');
    const existing = store.getProject(projectId);
    if (!existing) return context.json({ error: 'Project not found.' }, 404);

    const parsed = reviseBlueprintSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'The Blueprint answers are invalid.' }, 400);

    const project = await store.reviseProjectBlueprint(
      projectId,
      createBlueprint(existing.name, parsed.data.answers, existing.blueprint.metadata.revision + 1),
    );
    events.emit({
      type: 'blueprint.revised',
      projectId,
      projectName: project.name,
      occurredAt: new Date().toISOString(),
    });
    return context.json({ project, decisions: getBlueprintDecisions(project.blueprint) });
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
