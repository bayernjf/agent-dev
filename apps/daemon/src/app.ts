import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { blueprintAnswersSchema, createBaselinePlan, createBlueprint, createDryRunPlan, getBlueprintDecisions } from '@agent-dev/blueprint';
import { runAccountDiscovery, runConnectorPreflight, type AccountDiscoveryReport, type ConnectorPreflightReport } from '@agent-dev/policy';
import { AgentDevStore } from '@agent-dev/storage';
import { FakeProviderRegistry } from '@agent-dev/provider-core';
import { buildAgentExecutionPlan, discoverAgentRuntimes, isAgentExecutable, probeCodexRuntime, probeAgentCapabilities, type CustomAgentInput } from '@agent-dev/agent-runtime';
import { RealProviderRegistry, generateEnvFile, getCredentialMeta, loadCredentials, loadProjectResources, saveCredentials, verifyCredentials } from '@agent-dev/provider-cli';
import { DeploymentComposer, cleanupPreviewProjects } from '@agent-dev/deployment-composer';
import type { PreviewDeploymentResult } from '@agent-dev/deployment-composer';
import { DaemonEventBus } from './events.js';
import { buildFinalDeliveryReport, buildProviderSimulationReport, buildUnifiedDeliveryReport, providerSpecsFromBlueprint, buildRealProviderReport } from './providers.js';
import { loadCustomAgents, saveCustomAgents } from './agent-catalog.js';

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

const featureTaskSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(10).max(2000),
  acceptanceCriteria: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
});

const featureTaskApprovalSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal('APPROVE_FEATURE_TASK'),
  approvedBy: z.string().trim().min(1).max(120).default('local-user'),
});

const acceptanceSchema = z.object({
  summary: z.string().trim().min(10).max(2000),
  criteriaConfirmed: z.boolean(),
});

const acceptanceApprovalSchema = z.object({
  confirmation: z.literal('APPROVE_DELIVERY'),
  approvedBy: z.string().trim().min(1).max(120).default('local-user'),
});

const customAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  launchCommand: z.string().trim().min(1).max(200),
});

const credentialsSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().min(1).max(10_000));

export type DaemonDependencies = {
  runPreflight?: () => Promise<ConnectorPreflightReport>;
  runAccountDiscovery?: () => Promise<AccountDiscoveryReport>;
};

export function createDaemonApp(store: AgentDevStore, events = new DaemonEventBus(), dependencies: DaemonDependencies = {}, dataDirectory?: string) {
  const app = new Hono();
  const customAgents: CustomAgentInput[] = dataDirectory ? loadCustomAgents(dataDirectory) : [];

  app.use('*', cors({ origin: 'http://localhost:5173' }));
  const fakeProviders = new FakeProviderRegistry();
  const realProviders = new RealProviderRegistry({
    resolveContext: async (projectId: string) => {
      const project = store.getProject(projectId);
      if (!project) return null;
      const run = store.getLatestApplyRun(projectId, project.blueprint.metadata.revision);
      if (!run || run.status !== 'completed') return null;
      return { workspacePath: run.workspacePath, projectName: project.name, projectId, blueprintRevision: project.blueprint.metadata.revision };
    },
  });

  app.get('/api/health', context =>
    context.json({ service: 'agent-dev-daemon', status: 'ok', version: '0.1.0-alpha.0' }),
  );

  app.get('/api/connectors/preflight', async context =>
    context.json(await (dependencies.runPreflight ?? runConnectorPreflight)()),
  );

  app.get('/api/connectors/discovery', async context =>
    context.json(await (dependencies.runAccountDiscovery ?? runAccountDiscovery)()),
  );

  app.get('/api/credentials', context => context.json({ meta: getCredentialMeta() }));

  app.post('/api/credentials', async context => {
    const parsed = credentialsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Credentials must be an object of uppercase key/value pairs.' }, 400);
    saveCredentials({ ...loadCredentials(), ...parsed.data });
    return context.json({ saved: true, meta: getCredentialMeta() });
  });

  app.delete('/api/credentials/:key', context => {
    const key = context.req.param('key');
    const credentials = loadCredentials();
    if (!(key in credentials)) return context.json({ error: 'Credential not found.' }, 404);
    delete credentials[key];
    saveCredentials(credentials);
    return context.json({ saved: true, meta: getCredentialMeta() });
  });

  app.post('/api/credentials/verify', async context => {
    const creds = loadCredentials();
    const results = await verifyCredentials(creds);
    return context.json({ results });
  });

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

  app.get('/api/projects/:projectId/feature-task', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ task: await store.getFeatureTask(project.id, project.blueprint.metadata.revision) });
  });

  app.get('/api/runtime/probe', context => context.json({ probe: probeCodexRuntime() }));

  app.get('/api/runtime/probe/:agentId', context => {
    const agentId = context.req.param('agentId');
    const catalog = discoverAgentRuntimes(customAgents);
    const agent = catalog.find(a => a.id === agentId);
    if (!agent) return context.json({ error: 'Agent not found in catalog.' }, 404);
    return context.json({ probe: probeAgentCapabilities(agent.id, agent.launchCommand), executable: isAgentExecutable(agent.id) });
  });

  app.get('/api/runtime/catalog', context => context.json({ agents: discoverAgentRuntimes(customAgents) }));

  app.post('/api/runtime/catalog', async context => {
    const parsed = customAgentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Custom Agent requires a name and launchCommand.' }, 400);
    if (customAgents.some(agent => agent.name.toLowerCase() === parsed.data.name.toLowerCase())) return context.json({ error: 'An Agent with this name already exists.' }, 409);
    customAgents.push(parsed.data);
    if (dataDirectory) saveCustomAgents(dataDirectory, customAgents);
    return context.json({ agent: discoverAgentRuntimes(customAgents).at(-1) }, 201);
  });

  app.get('/api/projects/:projectId/runtime/plan', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const task = await store.getFeatureTask(project.id, project.blueprint.metadata.revision);
    if (!task || task.status !== 'approved') return context.json({ error: 'Approve a Feature Task before preparing a Runtime plan.' }, 409);
    const run = await store.getRuntimeRun(project.id, project.blueprint.metadata.revision);
    const agentId = run?.agentId ?? 'codex';
    const plan = isAgentExecutable(agentId) ? buildAgentExecutionPlan(task, task.workspacePath, agentId) : buildAgentExecutionPlan(task, task.workspacePath, 'codex');
    return context.json({ probe: probeCodexRuntime(), plan, run });
  });

  app.post('/api/projects/:projectId/runtime/run', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const body = await context.req.json().catch(() => null) as { confirmation?: string; agentId?: string } | null;
    if (body?.confirmation !== 'PREPARE_RUNTIME_RUN') return context.json({ error: 'Runtime preparation requires confirmation PREPARE_RUNTIME_RUN.' }, 400);
    if (body.agentId) {
      const catalog = discoverAgentRuntimes(customAgents);
      const agent = catalog.find(a => a.id === body.agentId);
      if (!agent) return context.json({ error: 'The selected Agent was not found in the catalog.' }, 404);
      if (!agent.detected) return context.json({ error: `Agent "${agent.name}" is not detected on PATH.` }, 409);
      if (!isAgentExecutable(agent.id)) return context.json({ error: `Agent "${agent.name}" is detected, but does not have a verified non-interactive execution adapter.` }, 409);
    }
    try {
      const run = await store.prepareRuntimeRun(project.id, project.blueprint.metadata.revision, body.agentId ?? 'codex');
      return context.json({ run, probe: probeCodexRuntime() }, 201);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to prepare the Runtime run.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/runtime/execute', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const body = await context.req.json().catch(() => null) as { confirmation?: string } | null;
    if (body?.confirmation !== 'EXECUTE_RUNTIME_RUN') return context.json({ error: 'Runtime execution requires confirmation EXECUTE_RUNTIME_RUN.' }, 400);
    try {
      const run = await store.executeRuntimeRun(project.id, project.blueprint.metadata.revision);
      return context.json({ run }, run.status === 'completed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to execute the Runtime run.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/runtime/retry', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const body = await context.req.json().catch(() => null) as { confirmation?: string } | null;
    if (body?.confirmation !== 'RETRY_RUNTIME_RUN') return context.json({ error: 'Runtime retry requires confirmation RETRY_RUNTIME_RUN.' }, 400);
    try {
      const run = await store.retryRuntimeRun(project.id, project.blueprint.metadata.revision);
      return context.json({ run }, run.status === 'completed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to retry the Runtime run.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/runtime/cancel', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const body = await context.req.json().catch(() => null) as { confirmation?: string } | null;
    if (body?.confirmation !== 'CANCEL_RUNTIME_RUN') return context.json({ error: 'Runtime cancellation requires confirmation CANCEL_RUNTIME_RUN.' }, 400);
    try {
      return context.json({ run: await store.cancelRuntimeRun(project.id, project.blueprint.metadata.revision) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to cancel the Runtime run.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/runtime/evidence', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      return context.json({ evidence: await store.getGitEvidence(project.id, project.blueprint.metadata.revision) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to collect Git evidence.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/acceptance', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ acceptance: await store.getAcceptance(project.id, project.blueprint.metadata.revision) });
  });

  app.get('/api/projects/:projectId/delivery-report', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const revision = project.blueprint.metadata.revision;
    const localApply = store.getLatestApplyRun(project.id, revision);
    const task = await store.getFeatureTask(project.id, revision);
    const runtime = await store.getRuntimeRun(project.id, revision);
    const quality = await store.getQualityGateResult(project.id, revision);
    const acceptance = await store.getAcceptance(project.id, revision);
    const git = localApply?.status === 'completed' ? await store.getGitEvidence(project.id, revision) : null;
    return context.json({ report: buildFinalDeliveryReport(project.name, { localApply, task, runtime: runtime ? { status: runtime.status, mode: runtime.plan.mode, executionAllowed: runtime.plan.executionAllowed } : null, quality, acceptance, git }) });
  });

  app.post('/api/projects/:projectId/acceptance', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = acceptanceSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Acceptance requires a summary and criteriaConfirmed boolean.' }, 400);
    try {
      const acceptance = await store.submitAcceptance(project.id, project.blueprint.metadata.revision, parsed.data.summary, parsed.data.criteriaConfirmed);
      return context.json({ acceptance }, acceptance.status === 'blocked' ? 422 : 200);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to submit acceptance.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/acceptance/approve', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = acceptanceApprovalSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Delivery approval requires confirmation APPROVE_DELIVERY.' }, 400);
    try {
      const acceptance = await store.approveAcceptance(project.id, project.blueprint.metadata.revision, parsed.data.approvedBy);
      return context.json({ acceptance });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to approve delivery.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/feature-task', async context => {
    const projectId = context.req.param('projectId');
    const parsed = featureTaskSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'A feature task requires a current revision, objective and at least one acceptance criterion.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'The feature task must target the current Blueprint revision.' }, 409);
    try {
      const task = await store.createFeatureTask({ projectId, ...parsed.data });
      return context.json({ task }, 201);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to create the feature task.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/feature-task/approve', async context => {
    const projectId = context.req.param('projectId');
    const parsed = featureTaskApprovalSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Feature task approval requires confirmation APPROVE_FEATURE_TASK.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'The feature task approval must target the current Blueprint revision.' }, 409);
    try {
      const task = await store.approveFeatureTask(projectId, parsed.data.blueprintRevision, parsed.data.approvedBy);
      return context.json({ task });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to approve the feature task.' }, 409);
    }
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

  app.get('/api/projects/:projectId/providers/plan', async context => {
    const projectId = context.req.param('projectId');
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const plans = await realProviders.plan(projectId, providerSpecsFromBlueprint(project.blueprint));
      return context.json({ projectId, real: true, plans });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to plan real providers.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/providers/apply', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal('APPLY_REAL_PROVIDERS') }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Real Provider Apply requires confirmation APPLY_REAL_PROVIDERS.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const approval = store.getBaselineApproval(projectId, project.blueprint.metadata.revision);
    if (!approval) return context.json({ error: 'Approve the baseline before applying real providers.' }, 409);
    try {
      const plans = await realProviders.plan(projectId, providerSpecsFromBlueprint(project.blueprint));
      const results = await realProviders.apply(projectId, plans, { id: `${approval.projectId}:${approval.blueprintRevision}`, status: approval.status, approvedAt: approval.approvedAt });
      events.emit({ type: 'providers.applied', projectId, projectName: project.name, occurredAt: new Date().toISOString() });
      return context.json({ projectId, real: true, results });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to apply real providers.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/providers/verify', async context => {
    const projectId = context.req.param('projectId');
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const verification = await realProviders.verify(projectId, providerSpecsFromBlueprint(project.blueprint));
      const plans = await realProviders.plan(projectId, providerSpecsFromBlueprint(project.blueprint));
      const report = buildRealProviderReport(project.name, plans, verification);
      return context.json({ projectId, real: true, verification, verified: verification.filter(v => v.providerId !== 'supabase').every(item => item.verified), report });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to verify real providers.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/resources', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    return context.json({ resources: run ? loadProjectResources(run.workspacePath) : null });
  });

  app.post('/api/projects/:projectId/env/regenerate', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run) return context.json({ error: 'No workspace found.' }, 404);
    generateEnvFile(run.workspacePath, loadCredentials(), loadProjectResources(run.workspacePath), project.name);
    return context.json({ generated: true, workspacePath: run.workspacePath });
  });

  // --- Preview Deployment Composer ---

  const previewSchema = z.object({
    confirmation: z.literal('DEPLOY_PREVIEW'),
    previewBranch: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Branch name must be lowercase alphanumeric with hyphens.'),
  });

  app.post('/api/projects/:projectId/preview/deploy', async context => {
    const projectId = context.req.param('projectId');
    const parsed = previewSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Preview deployment requires confirmation DEPLOY_PREVIEW and a valid previewBranch.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'Complete the baseline Apply before deploying a preview.' }, 409);

    try {
      const composer = new DeploymentComposer({
        workspacePath: run.workspacePath,
        projectName: project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        previewBranch: parsed.data.previewBranch,
      });
      const result = await composer.execute();
      events.emit({
        type: result.status === 'completed' ? 'preview.deployed' : 'preview.failed',
        projectId,
        projectName: project.name,
        occurredAt: new Date().toISOString(),
      });
      return context.json({ result }, result.status === 'completed' ? 200 : 422);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to execute preview deployment.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/preview/plan', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'Complete the baseline Apply before planning a preview.' }, 409);
    const composer = new DeploymentComposer({
      workspacePath: run.workspacePath,
      projectName: project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      previewBranch: 'preview',
    });
    return context.json({ steps: composer.plan(), idempotencyKey: composer.idempotencyKey });
  });

  app.post('/api/projects/:projectId/preview/cleanup', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal('CLEANUP_PREVIEW'), vercelProject: z.string().optional(), cloudflareProject: z.string().optional() }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Preview cleanup requires confirmation CLEANUP_PREVIEW.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run) return context.json({ error: 'No workspace found.' }, 404);

    try {
      const { defaultRunner } = await import('@agent-dev/provider-cli');
      const result = await cleanupPreviewProjects(defaultRunner, {
        vercelProject: parsed.data.vercelProject,
        cloudflareProject: parsed.data.cloudflareProject,
        workspacePath: run.workspacePath,
      });
      return context.json({ cleanup: result });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to cleanup preview projects.' }, 409);
    }
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
