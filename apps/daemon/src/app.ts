import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { blueprintAnswersSchema, createBaselinePlan, createBlueprint, createDryRunPlan, getBlueprintDecisions } from '@agent-dev/blueprint';
import { runAccountDiscovery, runConnectorPreflight, type AccountDiscoveryReport, type ConnectorPreflightReport } from '@agent-dev/policy';
import { AgentDevStore } from '@agent-dev/storage';
import { FakeProviderRegistry } from '@agent-dev/provider-core';
import { DaemonEventBus } from './events.js';
import { buildProviderSimulationReport, buildUnifiedDeliveryReport, providerSpecsFromBlueprint } from './providers.js';

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  answers: blueprintAnswersSchema.optional(),
});

const reviseBlueprintSchema = z.object({
  answers: blueprintAnswersSchema,
});

const approveBaselineSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal('APPROVE_BASELINE'),
  approvedBy: z.string().trim().min(1).max(120).default('local-user'),
});

const applyBaselineSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal('APPLY_BASELINE'),
});

const retryApplySchema = z.object({
  confirmation: z.literal('RETRY_APPLY'),
});

const qualityGateSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal('RUN_QUALITY_GATE'),
});

const dependencyInstallSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal('INSTALL_DEPENDENCIES'),
});

export type DaemonDependencies = {
  runPreflight?: () => Promise<ConnectorPreflightReport>;
  runAccountDiscovery?: () => Promise<AccountDiscoveryReport>;
};

export function createDaemonApp(store: AgentDevStore, events = new DaemonEventBus(), dependencies: DaemonDependencies = {}) {
  const app = new Hono();

  app.use('*', cors({ origin: 'http://localhost:5173' }));
  const fakeProviders = new FakeProviderRegistry();

  app.get('/api/health', context =>
    context.json({ service: 'agent-dev-daemon', status: 'ok', version: '0.1.0-alpha.0' }),
  );

  app.get('/api/connectors/preflight', async context =>
    context.json(await (dependencies.runPreflight ?? runConnectorPreflight)()),
  );

  app.get('/api/connectors/discovery', async context =>
    context.json(await (dependencies.runAccountDiscovery ?? runAccountDiscovery)()),
  );

  app.get('/api/projects', context => context.json({ projects: store.listProjects() }));

  app.get('/api/projects/:projectId', context => {
    const project = store.getProject(context.req.param('projectId'));
    return project ? context.json({ project }) : context.json({ error: 'Project not found.' }, 404);
  });

  app.get('/api/projects/:projectId/dry-run', context => {
    const project = store.getProject(context.req.param('projectId'));
    return project
      ? context.json({ projectId: project.id, plan: createDryRunPlan(project.blueprint) })
      : context.json({ error: 'Project not found.' }, 404);
  });

  app.get('/api/projects/:projectId/baseline-plan', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const plan = createBaselinePlan(project.blueprint);
    return context.json({ projectId: project.id, plan, approval: store.getBaselineApproval(project.id, plan.blueprintRevision) });
  });

  app.post('/api/projects/:projectId/baseline-plan/approve', async context => {
    const projectId = context.req.param('projectId');
    const parsed = approveBaselineSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Approval requires the current revision and confirmation APPROVE_BASELINE.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const approval = await store.approveBaseline(projectId, parsed.data.blueprintRevision, parsed.data.approvedBy);
      events.emit({
        type: 'baseline.approved',
        projectId,
        projectName: project.name,
        occurredAt: approval.approvedAt,
      });
      return context.json({ projectId, approval, plan: createBaselinePlan(project.blueprint) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to approve the baseline.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/apply', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ run: store.getLatestApplyRun(project.id, project.blueprint.metadata.revision) });
  });

  app.post('/api/projects/:projectId/apply', async context => {
    const projectId = context.req.param('projectId');
    const parsed = applyBaselineSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Apply requires the current revision and confirmation APPLY_BASELINE.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const queued = await store.createApplyRun(projectId, parsed.data.blueprintRevision);
      const run = await store.executeApplyRun(queued.id);
      events.emit({
        type: run.status === 'completed' ? 'apply.completed' : 'apply.failed',
        projectId,
        projectName: project.name,
        occurredAt: run.updatedAt,
      });
      return context.json({ run }, run.status === 'completed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to run local Apply.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/apply/retry', async context => {
    const projectId = context.req.param('projectId');
    const parsed = retryApplySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Retry requires confirmation RETRY_APPLY.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const existing = store.getLatestApplyRun(projectId, project.blueprint.metadata.revision);
    if (!existing) return context.json({ error: 'No Apply run is available to retry.' }, 404);
    if (existing.status !== 'failed') return context.json({ error: 'Only a failed Apply run can be retried.' }, 409);
    if (existing.attempts >= 3) return context.json({ error: 'Apply retry limit reached.' }, 409);
    const run = await store.executeApplyRun(existing.id);
    events.emit({ type: run.status === 'completed' ? 'apply.completed' : 'apply.failed', projectId, projectName: project.name, occurredAt: run.updatedAt });
    return context.json({ run }, run.status === 'completed' ? 200 : 422);
  });

  app.post('/api/projects/:projectId/quality-gate', async context => {
    const projectId = context.req.param('projectId');
    const parsed = qualityGateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Quality Gate requires the current revision and confirmation RUN_QUALITY_GATE.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'The quality gate must target the current Blueprint revision.' }, 409);
    try {
      const result = await store.runQualityGate(projectId, parsed.data.blueprintRevision);
      return context.json({ result }, result.status === 'passed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to run the quality gate.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/dependencies', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const readiness = await store.getDependencyReadiness(project.id, project.blueprint.metadata.revision);
    return context.json({ readiness });
  });

  app.post('/api/projects/:projectId/dependencies/install', async context => {
    const projectId = context.req.param('projectId');
    const parsed = dependencyInstallSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Dependency installation requires the current revision and confirmation INSTALL_DEPENDENCIES.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'Dependency installation must target the current Blueprint revision.' }, 409);
    try {
      const result = await store.installDependencies(projectId, parsed.data.blueprintRevision);
      return context.json({ result }, result.status === 'installed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to install dependencies.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/quality-gate', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ result: await store.getQualityGateResult(project.id, project.blueprint.metadata.revision) });
  });

  app.get('/api/projects/:projectId/provider-plan', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const plans = await fakeProviders.plan(project.id, providerSpecsFromBlueprint(project.blueprint));
    return context.json({ projectId: project.id, noExternalChanges: true, plans });
  });

  app.post('/api/projects/:projectId/provider-plan/apply', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal('APPLY_FAKE_PROVIDERS') }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Fake Provider Apply requires confirmation APPLY_FAKE_PROVIDERS.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const approval = store.getBaselineApproval(projectId, project.blueprint.metadata.revision);
    if (!approval) return context.json({ error: 'Approve the baseline before applying Fake Providers.' }, 409);
    const plans = await fakeProviders.plan(projectId, providerSpecsFromBlueprint(project.blueprint));
    const results = await fakeProviders.apply(projectId, plans, { id: `${approval.projectId}:${approval.blueprintRevision}`, status: approval.status, approvedAt: approval.approvedAt });
    return context.json({ projectId, noExternalChanges: true, results });
  });

  app.get('/api/projects/:projectId/provider-plan/verify', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const verification = await fakeProviders.verify(project.id, providerSpecsFromBlueprint(project.blueprint));
    const plans = await fakeProviders.plan(project.id, providerSpecsFromBlueprint(project.blueprint));
    const providerReport = buildProviderSimulationReport(project.name, plans, verification);
    const localApply = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    return context.json({ projectId: project.id, verification, verified: verification.every(item => item.verified), deliveryReport: providerReport, unifiedDeliveryReport: buildUnifiedDeliveryReport(project.name, localApply, providerReport) });
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
