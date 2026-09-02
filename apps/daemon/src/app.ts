import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { baselineProvidersFor, blueprintAnswersSchema, createBaselinePlan, createBlueprint, createDryRunPlan, getBlueprintDecisions, type ProductBlueprint } from '@agent-dev/blueprint';
import { verifyWorkspaceArtifacts } from '@agent-dev/blueprint/workspace';
import { CONFIRMATIONS, runAccountDiscovery, runConnectorPreflight, type AccountDiscoveryReport, type ConnectorPreflightReport } from '@agent-dev/policy';
import { AgentDevStore, type ReleaseStep } from '@agent-dev/storage';
import { FakeProviderRegistry } from '@agent-dev/provider-core';
import { AGENT_NOT_EXECUTABLE_CODE, buildAgentExecutionPlan, describeRuntimeExecutorRejection, discoverAgentRuntimes, getAgentAdapterStatus, isAgentExecutable, probeCodexRuntime, probeAgentCapabilities, resolveRuntimeExecutor, runDoctor, type CustomAgentInput, type AgentProfile, type RuntimeExecutor, agentProfileCreateSchema, agentProfileUpdateSchema } from '@agent-dev/agent-runtime';
import { GitHubAdapter, RealProviderRegistry, defaultRunner, generateEnvFile, getCredentialBackendInfo, getCredentialMeta, loadCredentials, loadProjectResources, saveCredentials, verifyCredentials } from '@agent-dev/provider-cli';
import type { ReleaseSource } from '@agent-dev/deployment-composer';
import { DeploymentComposer, ReleaseComposer, cleanupPreviewProjects, previewProjectNames, productionWebOrigin, releaseIdempotencyKey, releaseStepPlan } from '@agent-dev/deployment-composer';
import type { CleanupResult, PreviewDeploymentResult, ReleaseResult } from '@agent-dev/deployment-composer';
import { DaemonEventBus } from './events.js';
import { createTokenAuthMiddleware } from './auth.js';
import { buildFinalDeliveryReport, buildProviderSimulationReport, buildUnifiedDeliveryReport, providerSpecsFromBlueprint, buildRealProviderReport } from './providers.js';
import { loadCustomAgents, saveCustomAgents } from './agent-catalog.js';

// A Runtime executor that cannot be resolved is refused, never substituted. The refusal carries the
// shared code because GET runtime/plan already answers 409 for "nothing approved yet": one status,
// two different facts, and Studio has to say which one it means in the interface language.
function runtimeExecutorRejection(executor: RuntimeExecutor) {
  return { error: describeRuntimeExecutorRejection(executor), code: AGENT_NOT_EXECUTABLE_CODE, agentId: executor.agentId };
}

// `z.string().url()` accepts any scheme, including `ext::` (executes arbitrary commands when
// handed to git), `file://` (reads local repositories) and `javascript:` (stored XSS when rendered
// as a link). Every URL that reaches git or the UI must be http(s) (docs/audit-2026-08-31.md, S3/S7).
function httpUrlSchema(label: string) {
  return z.string().url().refine(
    value => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: `${label} must be an http:// or https:// URL.` },
  );
}

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  answers: blueprintAnswersSchema.optional(),
});

const reviseBlueprintSchema = z.object({
  answers: blueprintAnswersSchema,
});

const approveBaselineSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal(CONFIRMATIONS.APPROVE_BASELINE),
  approvedBy: z.string().trim().min(1).max(120),
});

const applyBaselineSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal(CONFIRMATIONS.APPLY_BASELINE),
  noExternalChanges: z.boolean().optional(),
  /** Optional: HTTPS URL of an existing Git repository to import instead of generating from scratch. */
  importRepositoryUrl: httpUrlSchema('importRepositoryUrl').optional(),
});

const retryApplySchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.RETRY_APPLY),
});

const recoverApplySchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.RECOVER_WORKSPACE),
});

const qualityGateSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal(CONFIRMATIONS.RUN_QUALITY_GATE),
});

const dependencyInstallSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal(CONFIRMATIONS.INSTALL_DEPENDENCIES),
});

const featureTaskSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(10).max(2000),
  acceptanceCriteria: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  pipeline: z.object({
    steps: z.array(z.object({
      name: z.string().min(1).max(100),
      profileId: z.string().min(1).max(120),
      prompt: z.string().min(1).max(10_000),
      dependsOn: z.array(z.string()).optional(),
      outputArtifact: z.string().max(500).optional(),
      continueOnFailure: z.boolean().optional(),
      requiresApproval: z.boolean().optional(),
    })).min(1).max(20),
  }).optional(),
});

const featureTaskApprovalSchema = z.object({
  blueprintRevision: z.number().int().positive(),
  confirmation: z.literal(CONFIRMATIONS.APPROVE_FEATURE_TASK),
  approvedBy: z.string().trim().min(1).max(120),
});

const acceptanceSchema = z.object({
  summary: z.string().trim().min(10).max(2000),
  criteriaConfirmed: z.boolean(),
});

const acceptanceApprovalSchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.APPROVE_DELIVERY),
  approvedBy: z.string().trim().min(1).max(120),
});

// Runtime routes historically parsed bodies by hand; these schemas match that contract while
// constraining agentId the way every other identifier in the API is constrained (audit §6.2-2).
const runtimePrepareSchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.PREPARE_RUNTIME_RUN),
  agentId: z.string().trim().min(1).max(120).optional(),
});
const runtimeExecuteSchema = z.object({ confirmation: z.literal(CONFIRMATIONS.EXECUTE_RUNTIME_RUN) });
const runtimeRetrySchema = z.object({ confirmation: z.literal(CONFIRMATIONS.RETRY_RUNTIME_RUN) });
const runtimeCancelSchema = z.object({ confirmation: z.literal(CONFIRMATIONS.CANCEL_RUNTIME_RUN) });

const prEvidenceSchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.RECORD_PR_EVIDENCE),
  url: httpUrlSchema('url'),
  checks: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
});

const previewEvidenceSchema = z.object({
  confirmation: z.literal(CONFIRMATIONS.RECORD_PREVIEW_EVIDENCE),
  apiUrl: httpUrlSchema('apiUrl'),
  webUrl: httpUrlSchema('webUrl'),
  smokeTest: z.string().trim().min(10).max(2000),
});

const customAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  launchCommand: z.string().trim().min(1).max(200),
});

const credentialsSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().min(1).max(10_000));

export type DaemonDependencies = {
  runPreflight?: () => Promise<ConnectorPreflightReport>;
  runAccountDiscovery?: () => Promise<AccountDiscoveryReport>;
  resolveGitHubWebhookSecret?: () => string | undefined;
  cleanupPreview?: (options: { vercelProject?: string; cloudflareProject?: string; workspacePath: string }) => Promise<CleanupResult>;
  deployRelease?: (options: { workspacePath: string; projectName: string; source: ReleaseSource }) => Promise<ReleaseResult>;
};

const githubPullRequestWebhookSchema = z.object({
  action: z.literal('closed'),
  repository: z.object({ name: z.string().trim().min(1) }),
  pull_request: z.object({ number: z.number().int().positive() }),
});

// Vercel and Cloudflare both reject names that are empty, contain anything outside
// [a-z0-9-], or start or end with a hyphen, so collapse runs and trim them here.
function projectSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function hasValidGitHubSignature(body: string, signature: string | undefined, secret: string) {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const received = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}

type BlueprintChange = {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  type: 'added' | 'removed' | 'modified';
};

function diffBlueprints(oldBp: Record<string, unknown>, newBp: Record<string, unknown>, prefix = ''): BlueprintChange[] {
  const changes: BlueprintChange[] = [];
  const allKeys = new Set([...Object.keys(oldBp ?? {}), ...Object.keys(newBp ?? {})]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldVal = oldBp?.[key];
    const newVal = newBp?.[key];
    if (oldVal === undefined && newVal !== undefined) {
      changes.push({ path, oldValue: undefined, newValue: newVal, type: 'added' });
    } else if (oldVal !== undefined && newVal === undefined) {
      changes.push({ path, oldValue: oldVal, newValue: undefined, type: 'removed' });
    } else if (typeof oldVal === 'object' && typeof newVal === 'object' && oldVal !== null && newVal !== null && !Array.isArray(oldVal) && !Array.isArray(newVal)) {
      changes.push(...diffBlueprints(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, path));
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ path, oldValue: oldVal, newValue: newVal, type: 'modified' });
    }
  }
  return changes;
}

// Read the daemon version from this package's package.json. Resolving from
// import.meta.url keeps the path correct regardless of the daemon's cwd.
const daemonVersion: string = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export type DaemonAppOptions = {
  /** When set, every /api/* route except the explicit exempt list requires
   * `Authorization: Bearer <token>` (docs/audit-2026-08-31.md §6.1-2). `startDaemon`
   * always sets this; omitting it keeps the app open for direct test usage. */
  authToken?: string;
};

export function createDaemonApp(store: AgentDevStore, events = new DaemonEventBus(), dependencies: DaemonDependencies = {}, dataDirectory?: string, options: DaemonAppOptions = {}) {
  const app = new Hono();
  const customAgents: CustomAgentInput[] = dataDirectory ? loadCustomAgents(dataDirectory) : [];

  app.use('*', cors({ origin: 'http://localhost:5173' }));
  // Registered before all routes so nothing slips past the check.
  if (options.authToken) app.use('/api/*', createTokenAuthMiddleware(options.authToken));
  const fakeProviders = new FakeProviderRegistry();
  const realProviders = new RealProviderRegistry({
    resolveContext: async (projectId: string) => {
      const project = store.getProject(projectId);
      if (!project) return null;
      const run = store.getLatestApplyRun(projectId, project.blueprint.metadata.revision);
      if (!run || run.status !== 'completed') return null;
      return { workspacePath: run.workspacePath, projectName: projectSlug(project.name), projectId, blueprintRevision: project.blueprint.metadata.revision, integrationBranch: project.blueprint.spec.sourceControl.integrationBranch, productionBranch: project.blueprint.spec.sourceControl.productionBranch };
    },
  });
  const executePreviewCleanup = dependencies.cleanupPreview ?? (options => cleanupPreviewProjects(defaultRunner, options));
  const executeRelease = dependencies.deployRelease ?? (options => new ReleaseComposer(options).execute());

  app.post('/api/github/webhooks', async context => {
    if (context.req.header('x-github-event') !== 'pull_request') return context.json({ ignored: true }, 202);
    const secret = dependencies.resolveGitHubWebhookSecret?.() ?? loadCredentials().GITHUB_WEBHOOK_SECRET;
    if (!secret) return context.json({ error: 'GitHub webhook secret is not configured.' }, 503);
    const body = await context.req.text();
    if (!hasValidGitHubSignature(body, context.req.header('x-hub-signature-256'), secret)) return context.json({ error: 'Invalid GitHub webhook signature.' }, 401);
    const payload = githubPullRequestWebhookSchema.safeParse((() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })());
    if (!payload.success) return context.json({ ignored: true }, 202);

    const projects = store.listProjects().filter(project => projectSlug(project.name) === projectSlug(payload.data.repository.name));
    if (projects.length !== 1) return context.json({ error: projects.length ? 'GitHub repository matches multiple local projects.' : 'No local project matches the GitHub repository.' }, projects.length ? 409 : 404);
    const project = store.getProject(projects[0].id);
    if (!project) return context.json({ error: 'Local project is unavailable.' }, 404);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'No completed local workspace is available for preview cleanup.' }, 409);

    const names = previewProjectNames(projectSlug(project.name), `pr-${payload.data.pull_request.number}`);
    const cleanup = await executePreviewCleanup({ ...names, workspacePath: run.workspacePath });
    events.emit({ type: cleanup.errors.length ? 'preview.cleanup_failed' : 'preview.cleaned', projectId: project.id, projectName: project.name, occurredAt: new Date().toISOString() });
    return context.json({ cleanup, projectId: project.id, previewBranch: `pr-${payload.data.pull_request.number}` }, cleanup.errors.length ? 422 : 200);
  });

  app.get('/api/health', context =>
    context.json({ service: 'agent-dev-daemon', status: 'ok', version: daemonVersion }),
  );

  app.get('/api/doctor', async context => {
    try {
      const report = await runDoctor();
      return context.json(report);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Doctor check failed' }, 500);
    }
  });

  // Auto-update endpoints were removed for the Pilot (docs/audit-2026-08-31.md §6.1-4): the old
  // POST /api/update ran `git pull` + `npm install` + `npm run build` behind no meaningful gate,
  // and GET /api/update/check executed `git fetch` on a nominally read-only route. Updating the
  // checkout is now a deliberate human act: stop the daemon, `git pull`, restart.

  // The /api/secret-backend/* management routes (status/keys/set/get/delete/rotate/approve/
  // reject/history) were removed for the Pilot (docs/audit-2026-08-31.md §6.3-1, S4): nothing
  // consumed them — Studio had no UI, the delivery pipeline uses the credentials system, and the
  // MCP bridge never exposed them — while GET /:key returned secret plaintext over HTTP. The
  // SecretBackend library itself stays in @agent-dev/provider-cli as groundwork for the planned
  // Infisical adapter (docs/implementation-plan-v0.2.md P1-2); if that lands, the routes come
  // back together with tests and documentation, not before.

  // Blueprint export/import/diff/revisions
  app.get('/api/projects/:projectId/blueprint/export', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({
      format: 'agent-dev-blueprint',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: { name: project.name, productType: project.productType },
      blueprint: project.blueprint,
    });
  });

  app.get('/api/projects/:projectId/blueprint/revisions', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const revisions = store.listBlueprintRevisions(project.id);
    return context.json({
      projectId: project.id,
      currentRevision: project.blueprint.metadata.revision,
      revisions: revisions.map(r => ({
        revision: r.revision,
        createdAt: r.createdAt,
        productType: r.blueprintJson.spec.product.type,
        runtime: r.blueprintJson.spec.runtime?.provider ?? 'codex',
      })),
    });
  });

  app.post('/api/projects/:projectId/blueprint/revise', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({
      blueprint: z.record(z.unknown()),
      confirmation: z.literal(CONFIRMATIONS.REVISE_BLUEPRINT),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Revise requires a blueprint object and confirmation REVISE_BLUEPRINT.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const { productBlueprintSchema } = await import('@agent-dev/blueprint');
      const validated = productBlueprintSchema.parse(parsed.data.blueprint);
      const previousRevision = project.blueprint.metadata.revision;
      const previousBlueprint = project.blueprint;
      const updated = await store.reviseBlueprint(projectId, validated);
      // Auto-generate diff for upgrade review
      const changes = diffBlueprints(
        previousBlueprint as unknown as Record<string, unknown>,
        updated.blueprint as unknown as Record<string, unknown>,
      );
      events.emit({ type: 'blueprint.revised', projectId, projectName: project.name, occurredAt: new Date().toISOString() });
      return context.json({
        project: updated,
        previousRevision,
        newRevision: updated.blueprint.metadata.revision,
        reviewRequired: changes.length > 0,
        changes,
        changeCount: changes.length,
        note: changes.length > 0
          ? `Blueprint upgraded from revision ${previousRevision} to ${updated.blueprint.metadata.revision} with ${changes.length} change(s). Review changes before applying.`
          : 'Blueprint revised with no substantive changes.',
      });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Failed to revise blueprint' }, 400);
    }
  });

  app.post('/api/projects/:projectId/blueprint/import', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({
      format: z.literal('agent-dev-blueprint'),
      version: z.literal(1),
      blueprint: z.record(z.unknown()),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid blueprint import format. Expected { format: "agent-dev-blueprint", version: 1, blueprint: {...} }.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      // Validate the imported blueprint against the schema.
      const { productBlueprintSchema } = await import('@agent-dev/blueprint');
      const validated = productBlueprintSchema.parse(parsed.data.blueprint);
      // Create a new revision with the imported blueprint.
      const updated = await store.reviseBlueprint(projectId, validated);
      return context.json({ project: updated, imported: true });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Failed to import blueprint' }, 400);
    }
  });

  app.get('/api/projects/:projectId/blueprint/diff', context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    // Compare current blueprint with the previous revision (if any).
    const revisions = store.listBlueprintRevisions(project.id);
    if (revisions.length < 2) {
      return context.json({ projectId: project.id, currentRevision: project.blueprint.metadata.revision, previousRevision: null, changes: [], note: 'No previous revision to compare against.' });
    }
    const current = project.blueprint;
    const previous = revisions[revisions.length - 2]!.blueprintJson;
    const changes = diffBlueprints(previous, current);
    return context.json({
      projectId: project.id,
      currentRevision: current.metadata.revision,
      previousRevision: previous.metadata.revision,
      changes,
      changeCount: changes.length,
    });
  });

  app.get('/api/connectors/preflight', async context =>
    context.json(await (dependencies.runPreflight ?? runConnectorPreflight)()),
  );

  app.get('/api/connectors/discovery', async context =>
    context.json(await (dependencies.runAccountDiscovery ?? runAccountDiscovery)()),
  );

  app.get('/api/credentials', context => context.json({ meta: getCredentialMeta() }));

  // Read-only secret backend status (type/availability/projectId). Never returns secret
  // material; the plaintext exit the audit removed (S4) stays removed — this route only
  // names the backend and whether it is reachable.
  app.get('/api/credentials/backend', async context => context.json(await getCredentialBackendInfo()));

  app.post('/api/credentials', async context => {
    const parsed = credentialsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Credentials must be an object of uppercase key/value pairs.' }, 400);
    await saveCredentials({ ...loadCredentials(), ...parsed.data });
    realProviders.invalidateCredentials();
    return context.json({ saved: true, meta: getCredentialMeta() });
  });

  app.delete('/api/credentials/:key', async context => {
    const key = context.req.param('key');
    const credentials = loadCredentials();
    if (!(key in credentials)) return context.json({ error: 'Credential not found.' }, 404);
    delete credentials[key];
    await saveCredentials(credentials);
    realProviders.invalidateCredentials();
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
    if (!parsed.success) return context.json({ error: 'Approval requires the current revision, confirmation APPROVE_BASELINE and the name of who approves it.' }, 400);
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
      // If importing an existing repository, clone it into the workspace before applying.
      if (parsed.data.importRepositoryUrl) {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const { mkdir, rm, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const execFileAsync = promisify(execFile);
        // Ensure workspace directory exists and is empty for clone.
        await rm(queued.workspacePath, { recursive: true, force: true });
        await mkdir(queued.workspacePath, { recursive: true });
        // Clone the repository (shallow, default branch).
        await execFileAsync('git', ['clone', '--depth', '1', parsed.data.importRepositoryUrl, '.'], { cwd: queued.workspacePath, timeout: 60_000 });
        // Ensure the integration branch (dev) exists. Imported repositories may only
        // have a main/master branch; Agent-Dev needs dev as the baseline for PRs.
        const integrationBranch = project.blueprint.spec.sourceControl?.integrationBranch ?? 'dev';
        const branches = await execFileAsync('git', ['branch', '--list', integrationBranch], { cwd: queued.workspacePath });
        if (!branches.stdout.trim()) {
          await execFileAsync('git', ['switch', '-c', integrationBranch], { cwd: queued.workspacePath });
        } else {
          await execFileAsync('git', ['switch', integrationBranch], { cwd: queued.workspacePath });
        }
        // Record import metadata so executeApplyRun knows this is an imported repository
        // and should not wipe-and-reclone (which would lose the imported history).
        await writeFile(join(queued.workspacePath, '.agent-dev-import'), JSON.stringify({
          sourceUrl: parsed.data.importRepositoryUrl,
          importedAt: new Date().toISOString(),
          originalBranch: (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: queued.workspacePath })).stdout.trim(),
        }, null, 2) + '\n', 'utf8');
      }
      const run = await store.executeApplyRun(queued.id);
      events.emit({
        type: run.status === 'completed' ? 'apply.completed' : 'apply.failed',
        projectId,
        projectName: project.name,
        occurredAt: run.updatedAt,
      });
      return context.json({ run, imported: Boolean(parsed.data.importRepositoryUrl) }, run.status === 'completed' ? 200 : 422);
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

  // A workspace that is unusable cannot be repaired in place: a failed run may have left a partial
  // tree, and a stale one was written by an older generator. Recovery therefore starts a clean
  // workspace and reports the Git state of the old one instead of deleting it.
  app.post('/api/projects/:projectId/apply/recover', async context => {
    const projectId = context.req.param('projectId');
    const parsed = recoverApplySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Recovery requires confirmation RECOVER_WORKSPACE.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const revision = project.blueprint.metadata.revision;
    const existing = store.getLatestApplyRun(projectId, revision);
    if (!existing) return context.json({ error: 'No Apply run is available to recover; start Apply instead.' }, 404);

    const workspace = await verifyWorkspaceArtifacts(existing.workspacePath, project.blueprint);
    if (existing.status !== 'failed' && workspace.usable) {
      return context.json({ error: 'The current workspace is usable; recovery is only for a failed or stale workspace.', workspace }, 409);
    }

    const abandoned = await store.describeApplyWorkspace(existing.id);
    const recovery = await store.createRecoveryApplyRun(projectId, revision);
    const run = await store.executeApplyRun(recovery.id);
    events.emit({ type: run.status === 'completed' ? 'apply.recovered' : 'apply.failed', projectId, projectName: project.name, occurredAt: run.updatedAt });
    return context.json({
      run,
      abandoned: { ...abandoned, status: existing.status, workspace },
    }, run.status === 'completed' ? 200 : 422);
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
    return context.json({ probe: probeAgentCapabilities(agent.id, agent.launchCommand), adapterStatus: getAgentAdapterStatus(agent.id) });
  });

  // `detected` answers "is this CLI installed here", which is not the claim Studio makes next to
  // the name. Only the Adapter registry knows whether the execution contract has been exercised, so
  // the answer travels with the catalog instead of being guessed by the browser.
  app.get('/api/runtime/catalog', context => context.json({
    agents: discoverAgentRuntimes(customAgents).map(agent => ({ ...agent, adapterStatus: getAgentAdapterStatus(agent.id) })),
  }));

  app.post('/api/runtime/catalog', async context => {
    const parsed = customAgentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Custom Agent requires a name and launchCommand.' }, 400);
    if (customAgents.some(agent => agent.name.toLowerCase() === parsed.data.name.toLowerCase())) return context.json({ error: 'An Agent with this name already exists.' }, 409);
    customAgents.push(parsed.data);
    if (dataDirectory) saveCustomAgents(dataDirectory, customAgents);
    const agent = discoverAgentRuntimes(customAgents).at(-1);
    return context.json({ agent: agent ? { ...agent, adapterStatus: getAgentAdapterStatus(agent.id) } : agent }, 201);
  });

  // --- Agent Profiles ---

  app.get('/api/runtime/profiles', async context => {
    const profiles = await store.profiles.listProfiles();
    return context.json({ profiles });
  });

  app.get('/api/runtime/profiles/:profileId', async context => {
    const profile = await store.profiles.getProfile(context.req.param('profileId'));
    if (!profile) return context.json({ error: 'Profile not found.' }, 404);
    return context.json({ profile });
  });

  app.post('/api/runtime/profiles', async context => {
    const parsed = agentProfileCreateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid profile input.', details: parsed.error.flatten() }, 400);
    // Base agent must be verified/executable
    if (!isAgentExecutable(parsed.data.baseAgentId)) {
      return context.json({ error: `Base agent "${parsed.data.baseAgentId}" is not verified. Profiles can only be based on verified agents.` }, 400);
    }
    const { profile, validation } = await store.profiles.createProfile(parsed.data, {
      verifyBaseAgent: id => isAgentExecutable(id),
    });
    if (!validation.valid) return context.json({ error: 'Profile validation failed.', details: validation.errors }, 400);
    return context.json({ profile }, 201);
  });

  app.put('/api/runtime/profiles/:profileId', async context => {
    const parsed = agentProfileUpdateSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid profile update.', details: parsed.error.flatten() }, 400);
    const profileId = context.req.param('profileId');
    const existing = await store.profiles.getProfile(profileId);
    if (!existing) return context.json({ error: 'Profile not found.' }, 404);
    const { profile, validation } = await store.profiles.updateProfile(profileId, parsed.data);
    if (!validation.valid) return context.json({ error: 'Profile validation failed.', details: validation.errors }, 400);
    return context.json({ profile });
  });

  app.delete('/api/runtime/profiles/:profileId', async context => {
    const profileId = context.req.param('profileId');
    const deleted = await store.profiles.deleteProfile(profileId);
    if (!deleted) return context.json({ error: 'Profile not found.' }, 404);
    return context.json({ deleted: true });
  });

  app.get('/api/projects/:projectId/runtime/plan', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const task = await store.getFeatureTask(project.id, project.blueprint.metadata.revision);
    if (!task || task.status !== 'approved') return context.json({ error: 'Approve a Feature Task before preparing a Runtime plan.' }, 409);
    const run = await store.getRuntimeRun(project.id, project.blueprint.metadata.revision);
    // Prefer the recorded executor, then the Blueprint-selected runtime; 'codex' is only the default
    // for a Blueprint that never named one. Whatever the layers agree on has to be executable - this
    // route used to answer an unresolvable executor by building a Codex plan, which showed a plan for
    // an Agent nobody had selected.
    const resolved = await resolveRuntimeExecutor(
      run?.agentId ?? project.blueprint.spec.runtime?.provider ?? 'codex',
      id => store.profiles.getProfile(id),
    );
    if (!resolved.ok) return context.json(runtimeExecutorRejection(resolved), 409);
    const plan = buildAgentExecutionPlan(task, task.workspacePath, resolved.agentId, { profile: resolved.profile });
    return context.json({ probe: probeCodexRuntime(), plan, run });
  });

  app.post('/api/projects/:projectId/runtime/run', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = runtimePrepareSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Runtime preparation requires confirmation PREPARE_RUNTIME_RUN.' }, 400);
    const body = parsed.data;
    if (body.agentId) {
      const catalog = discoverAgentRuntimes(customAgents);
      // Check if the agentId refers to an Agent Profile first.
      const profile = await store.profiles.getProfile(body.agentId);
      if (profile) {
        const baseAgent = catalog.find(a => a.id === profile.baseAgentId);
        if (!baseAgent) return context.json({ error: `Profile base agent "${profile.baseAgentId}" was not found in the catalog.` }, 404);
        if (!baseAgent.detected) return context.json({ error: `Profile base agent "${baseAgent.name}" is not detected on PATH.` }, 409);
        if (!isAgentExecutable(profile.baseAgentId)) return context.json({ error: `Profile base agent "${baseAgent.name}" does not have a verified non-interactive execution adapter.` }, 409);
      } else {
        const agent = catalog.find(a => a.id === body.agentId);
        if (!agent) return context.json({ error: 'The selected Agent was not found in the catalog.' }, 404);
        if (!agent.detected) return context.json({ error: `Agent "${agent.name}" is not detected on PATH.` }, 409);
        if (!isAgentExecutable(agent.id)) return context.json({ error: `Agent "${agent.name}" is detected, but does not have a verified non-interactive execution adapter.` }, 409);
      }
    }
    try {
      // A request may override the runtime; otherwise the Blueprint-selected provider is used. Both
      // are resolved with the one rule, so a Blueprint that names an Agent the Adapter registry does
      // not trust cannot quietly produce a run record for Codex.
      const requested = body.agentId ?? project.blueprint.spec.runtime?.provider ?? 'codex';
      const resolved = await resolveRuntimeExecutor(requested, id => store.profiles.getProfile(id));
      if (!resolved.ok) return context.json(runtimeExecutorRejection(resolved), 409);
      const run = await store.prepareRuntimeRun(project.id, project.blueprint.metadata.revision, requested);
      return context.json({ run, probe: probeCodexRuntime() }, 201);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to prepare the Runtime run.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/runtime/execute', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (!runtimeExecuteSchema.safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Runtime execution requires confirmation EXECUTE_RUNTIME_RUN.' }, 400);
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
    if (!runtimeRetrySchema.safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Runtime retry requires confirmation RETRY_RUNTIME_RUN.' }, 400);
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
    if (!runtimeCancelSchema.safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: 'Runtime cancellation requires confirmation CANCEL_RUNTIME_RUN.' }, 400);
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
    if (!parsed.success) return context.json({ error: 'Delivery approval requires confirmation APPROVE_DELIVERY and the name of who accepts the delivery.' }, 400);
    try {
      const acceptance = await store.approveAcceptance(project.id, project.blueprint.metadata.revision, parsed.data.approvedBy);
      return context.json({ acceptance });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to approve delivery.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/delivery/pr-evidence', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = prEvidenceSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'PR evidence requires RECORD_PR_EVIDENCE, a URL, and at least one check.' }, 400);
    try {
      const evidence = await store.recordPrEvidence(project.id, project.blueprint.metadata.revision, { url: parsed.data.url, checks: parsed.data.checks });
      return context.json({ evidence, project: store.getProject(project.id) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to record PR evidence.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/delivery/pull-request', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.OPEN_PULL_REQUEST) }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Opening a pull request requires confirmation OPEN_PULL_REQUEST.' }, 400);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'A completed Local Apply run is required before opening a pull request.' }, 409);
    const repository = loadProjectResources(run.workspacePath)?.providers.github?.repository;
    if (typeof repository !== 'string' || !repository) return context.json({ error: 'Apply the real GitHub provider before opening a pull request: no repository is recorded for this workspace.' }, 409);
    try {
      const adapter = new GitHubAdapter(project.blueprint.spec.sourceControl.owner, projectSlug(project.name), run.workspacePath);
      const evidence = await store.publishPullRequest(project.id, project.blueprint.metadata.revision, request => adapter.publishPullRequest({ ...request, expectedRepository: repository }));
      events.emit({ type: 'delivery.pr_opened', projectId: project.id, projectName: project.name, occurredAt: evidence.recordedAt });
      return context.json({ evidence, project: store.getProject(project.id) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to open a pull request.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/delivery/pr-evidence', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ evidence: await store.getPrEvidence(project.id, project.blueprint.metadata.revision) });
  });

  app.post('/api/projects/:projectId/delivery/preview-evidence', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const parsed = previewEvidenceSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Preview evidence requires RECORD_PREVIEW_EVIDENCE, API and Web URLs, and a smoke-test note.' }, 400);
    try {
      const evidence = await store.recordPreviewEvidence(project.id, project.blueprint.metadata.revision, { apiUrl: parsed.data.apiUrl, webUrl: parsed.data.webUrl, smokeTest: parsed.data.smokeTest });
      return context.json({ evidence, project: store.getProject(project.id) });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to record Preview evidence.' }, 409);
    }
  });

  app.get('/api/projects/:projectId/delivery/preview-evidence', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    return context.json({ evidence: await store.getPreviewEvidence(project.id, project.blueprint.metadata.revision) });
  });

  app.post('/api/projects/:projectId/feature-task', async context => {
    const projectId = context.req.param('projectId');
    const parsed = featureTaskSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'A feature task requires a current revision, objective and at least one acceptance criterion.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'The feature task must target the current Blueprint revision.' }, 409);
    try {
      const task = await store.createFeatureTask({
        projectId,
        ...parsed.data,
        pipeline: parsed.data.pipeline
          ? {
              ...parsed.data.pipeline,
              steps: parsed.data.pipeline.steps.map((step, index) => ({ ...step, id: `step-${index + 1}` })),
              currentStepIndex: 0,
              results: [],
              status: 'idle' as const,
            }
          : undefined,
      });
      return context.json({ task }, 201);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to create the feature task.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/feature-task/approve', async context => {
    const projectId = context.req.param('projectId');
    const parsed = featureTaskApprovalSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Feature task approval requires confirmation APPROVE_FEATURE_TASK and the name of who approves it.' }, 400);
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

  app.post('/api/projects/:projectId/pipeline/execute', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ blueprintRevision: z.number().int().positive() }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Pipeline execution requires a current blueprint revision.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    if (project.blueprint.metadata.revision !== parsed.data.blueprintRevision) return context.json({ error: 'The pipeline must target the current Blueprint revision.' }, 409);
    try {
      const task = await store.executeFeatureTaskPipeline(projectId, parsed.data.blueprintRevision);
      return context.json({ task });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to execute the pipeline.' }, 409);
    }
  });

  app.put('/api/projects/:projectId/pipeline', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({
      steps: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120),
        profileId: z.string().min(1),
        prompt: z.string().max(4000).default(''),
      })).min(1),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Pipeline steps are required (at least one step with name and profileId).' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const task = await store.updateFeatureTaskPipeline(projectId, project.blueprint.metadata.revision, parsed.data.steps);
      return context.json({ task });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to update the pipeline.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/pipeline/resume', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ blueprintRevision: z.number().int().positive() }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Pipeline resume requires a current blueprint revision.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    try {
      const task = await store.resumeFeatureTaskPipeline(projectId, parsed.data.blueprintRevision);
      return context.json({ task });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to resume the pipeline.' }, 409);
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
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.APPLY_FAKE_PROVIDERS) }).safeParse(await context.req.json().catch(() => null));
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
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.APPLY_REAL_PROVIDERS) }).safeParse(await context.req.json().catch(() => null));
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

  // The composer runs a fixed Vercel-then-Cloudflare pipeline over `apps/api` and `apps/web`. A
  // product type that deploys to neither has nothing for it to do, and letting it run would try to
  // deploy directories the scaffold never generates — after it has already recorded a Vercel project
  // as possibly created, which would then advertise cleanup for a project that never existed.
  const noHostedDeploymentReason = (blueprint: ProductBlueprint) => {
    const providers = baselineProvidersFor(blueprint.spec.product.type);
    if (providers.includes('cloudflare') || providers.includes('vercel')) return null;
    return `The ${blueprint.spec.product.type} product type has no hosted deployment target, so there is no preview or production URL to deploy. Distribution is manual — see generated/DISTRIBUTION.md in the workspace.`;
  };

  const previewSchema = z.object({
    confirmation: z.literal(CONFIRMATIONS.DEPLOY_PREVIEW),
    previewBranch: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Branch name must be lowercase alphanumeric with hyphens.').optional(),
    pullRequestNumber: z.number().int().positive().optional(),
  }).refine(data => Boolean(data.previewBranch || data.pullRequestNumber), 'A previewBranch or pullRequestNumber is required.');

  app.post('/api/projects/:projectId/preview/deploy', async context => {
    const projectId = context.req.param('projectId');
    const parsed = previewSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Preview deployment requires confirmation DEPLOY_PREVIEW and a valid previewBranch.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const unsupported = noHostedDeploymentReason(project.blueprint);
    if (unsupported) return context.json({ error: unsupported }, 409);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'Complete the baseline Apply before deploying a preview.' }, 409);
    const workspace = await verifyWorkspaceArtifacts(run.workspacePath, project.blueprint);
    if (!workspace.usable) return context.json({ error: workspace.reason, workspace }, 409);
    const previewBranch = parsed.data.pullRequestNumber ? `pr-${parsed.data.pullRequestNumber}` : parsed.data.previewBranch!;

    try {
      const composer = new DeploymentComposer({
        workspacePath: run.workspacePath,
        projectName: projectSlug(project.name),
        previewBranch,
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

  app.get('/api/projects/:projectId/preview/plan', async context => {
    const project = store.getProject(context.req.param('projectId'));
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const unsupported = noHostedDeploymentReason(project.blueprint);
    if (unsupported) return context.json({ error: unsupported }, 409);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run || run.status !== 'completed') return context.json({ error: 'Complete the baseline Apply before planning a preview.' }, 409);
    const workspace = await verifyWorkspaceArtifacts(run.workspacePath, project.blueprint);
    const composer = new DeploymentComposer({
      workspacePath: run.workspacePath,
      projectName: projectSlug(project.name),
      previewBranch: 'preview',
    });
    return context.json({
      steps: composer.plan(),
      idempotencyKey: composer.idempotencyKey,
      workspace,
    }, workspace.usable ? 200 : 409);
  });

  app.post('/api/projects/:projectId/preview/cleanup', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.CLEANUP_PREVIEW), vercelProject: z.string().optional(), cloudflareProject: z.string().optional() }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Preview cleanup requires confirmation CLEANUP_PREVIEW.' }, 400);
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const unsupported = noHostedDeploymentReason(project.blueprint);
    if (unsupported) return context.json({ error: unsupported }, 409);
    const run = store.getLatestApplyRun(project.id, project.blueprint.metadata.revision);
    if (!run) return context.json({ error: 'No workspace found.' }, 404);

    try {
      const result = await executePreviewCleanup({
        vercelProject: parsed.data.vercelProject,
        cloudflareProject: parsed.data.cloudflareProject,
        workspacePath: run.workspacePath,
      });
      return context.json({ cleanup: result });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to cleanup preview projects.' }, 409);
    }
  });

  // --- Production Release ---

  // Production is the one path where the human decision is load-bearing, so the request and the
  // approval are separate calls with separate confirmations. Nothing here can be reached by a
  // single click, and the release is journalled before any provider call runs.
  const resolveReleaseContext = async (projectId: string) => {
    const project = store.getProject(projectId);
    if (!project) return { error: 'Project not found.' as const, statusCode: 404 as const };
    // Types without a hosted deployment target still release: their release is a human confirming
    // the manual distribution steps, not a composer deploying to a URL.
    const manualDistribution = noHostedDeploymentReason(project.blueprint) !== null;
    const revision = project.blueprint.metadata.revision;
    const run = store.getLatestApplyRun(projectId, revision);
    if (!run || run.status !== 'completed') return { error: 'Complete the baseline Apply before releasing to production.' as const, statusCode: 409 as const };
    const workspace = await verifyWorkspaceArtifacts(run.workspacePath, project.blueprint);
    const branch = project.blueprint.spec.sourceControl.productionBranch;
    const repository = loadProjectResources(run.workspacePath)?.providers.github?.repository;
    const acceptance = await store.getAcceptance(projectId, revision);
    // Production is released from the production branch of the recorded repository and has to carry
    // the commit a human accepted, so both facts are prerequisites rather than inputs.
    const sourceReason = typeof repository !== 'string' || !repository
      ? 'No repository is recorded for this workspace, so there is no production branch to release from. Apply the real GitHub provider first.'
      : !acceptance || acceptance.status !== 'approved'
        ? 'Approve the delivery before releasing to production: without an accepted commit there is nothing to verify production against.'
        : undefined;
    const source: ReleaseSource | null = sourceReason ? null : {
      repository: repository as string,
      branch,
      acceptedCommit: acceptance!.gitEvidence.head,
      checkoutPath: join(store.dataDirectory, 'releases', projectId, branch),
    };
    return { project, revision, run, workspace, source, sourceReason, manualDistribution };
  };

  // The single step a manual distribution release journals: there is nothing to deploy, so the run
  // completes when the named approver confirms the steps in generated/DISTRIBUTION.md were done.
  const manualDistributionSteps = (): ReleaseStep[] => [{
    id: 'confirm-manual-distribution',
    title: 'Confirm the manual distribution steps from generated/DISTRIBUTION.md',
    status: 'pending',
  }];

  const runRelease = async (
    projectId: string,
    projectName: string,
    revision: number,
    workspacePath: string,
    releaseRunId: string,
    source: ReleaseSource,
  ) => {
    const result = await executeRelease({ workspacePath, projectName: projectSlug(projectName), source });
    if (result.status !== 'completed' || !result.apiBaseUrl || !result.webUrl || !result.observations) {
      const failed = await store.failRelease(releaseRunId, result.steps);
      events.emit({ type: 'release.failed', projectId, projectName, occurredAt: failed.updatedAt });
      return { result, releaseRun: failed, statusCode: 422 as const };
    }
    const journalled = await store.updateReleaseRun(releaseRunId, 'completed', result.steps);
    const evidence = await store.recordReleaseEvidence(projectId, revision, {
      projectName: projectSlug(projectName),
      apiBaseUrl: result.apiBaseUrl,
      webUrl: result.webUrl,
      corsOrigin: result.corsOrigin ?? productionWebOrigin(projectSlug(projectName)),
      approvedBy: journalled.approvedBy,
      approvalSummary: journalled.approvalSummary,
      observations: result.observations as unknown as Record<string, unknown>,
    });
    events.emit({ type: 'release.completed', projectId, projectName, occurredAt: evidence.recordedAt });
    return { result, releaseRun: journalled, evidence, statusCode: 200 as const };
  };

  app.get('/api/projects/:projectId/release/plan', async context => {
    const projectId = context.req.param('projectId');
    const resolved = await resolveReleaseContext(projectId);
    if ('error' in resolved) return context.json({ error: resolved.error }, resolved.statusCode);
    const { project, revision, workspace, source, sourceReason, manualDistribution } = resolved;
    return context.json({
      steps: manualDistribution ? manualDistributionSteps() : releaseStepPlan(),
      manualDistribution,
      source,
      sourceReason,
      idempotencyKey: releaseIdempotencyKey(projectSlug(project.name)),
      corsOrigin: manualDistribution ? undefined : productionWebOrigin(projectSlug(project.name)),
      productionApproval: project.blueprint.spec.policy.productionApproval,
      state: project.state,
      workspace,
      releaseRun: store.getLatestReleaseRun(projectId, revision),
    }, workspace.usable ? 200 : 409);
  });

  app.get('/api/projects/:projectId/release', async context => {
    const projectId = context.req.param('projectId');
    const project = store.getProject(projectId);
    if (!project) return context.json({ error: 'Project not found.' }, 404);
    const revision = project.blueprint.metadata.revision;
    return context.json({
      state: project.state,
      releaseRun: store.getLatestReleaseRun(projectId, revision),
      evidence: await store.getReleaseEvidence(projectId, revision),
    });
  });

  app.post('/api/projects/:projectId/release/request', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.REQUEST_RELEASE) }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Requesting a release requires confirmation REQUEST_RELEASE.' }, 400);
    const resolved = await resolveReleaseContext(projectId);
    if ('error' in resolved) return context.json({ error: resolved.error }, resolved.statusCode);
    if (!resolved.workspace.usable) return context.json({ error: resolved.workspace.reason, workspace: resolved.workspace }, 409);
    if (!resolved.source) return context.json({ error: resolved.sourceReason }, 409);
    // The PR_OPEN shortcut exists for products with no hosted deployment target. A hosted product
    // that skipped the preview gate could release to production without a recorded deployment.
    if (!resolved.manualDistribution && resolved.project.state === 'PR_OPEN') {
      return context.json({ error: 'Deploy and record a preview before releasing a hosted product: production must follow the preview gate.' }, 409);
    }
    try {
      const project = await store.requestRelease(projectId, resolved.revision);
      events.emit({ type: 'release.requested', projectId, projectName: project.name, occurredAt: new Date().toISOString() });
      return context.json({ state: project.state });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to request a release.' }, 409);
    }
  });

  app.post('/api/projects/:projectId/release/approve', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({
      confirmation: z.literal(CONFIRMATIONS.APPROVE_RELEASE),
      approvedBy: z.string().trim().min(1).max(120),
      summary: z.string().trim().min(1).max(2000),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Approving a release requires confirmation APPROVE_RELEASE, approvedBy and summary.' }, 400);
    const resolved = await resolveReleaseContext(projectId);
    if ('error' in resolved) return context.json({ error: resolved.error }, resolved.statusCode);
    const { project, revision, run, workspace, source, sourceReason, manualDistribution } = resolved;
    if (!workspace.usable) return context.json({ error: workspace.reason, workspace }, 409);
    if (!source) return context.json({ error: sourceReason }, 409);

    if (manualDistribution) {
      // There is nothing to deploy: the approval itself is the distribution confirmation. The human
      // gates stay intact — named approver, recorded summary, evidence written from the production branch.
      try {
        const steps = manualDistributionSteps();
        const approved = await store.approveRelease(projectId, revision, {
          approvedBy: parsed.data.approvedBy,
          summary: parsed.data.summary,
          steps,
        });
        events.emit({ type: 'release.approved', projectId, projectName: project.name, occurredAt: approved.createdAt });
        const confirmedAt = new Date().toISOString();
        const releaseRun = await store.updateReleaseRun(approved.id, 'completed', [{
          ...steps[0], status: 'completed', startedAt: confirmedAt, completedAt: confirmedAt, detail: parsed.data.summary,
        }]);
        const evidence = await store.recordReleaseEvidence(projectId, revision, {
          projectName: projectSlug(project.name),
          distribution: 'manual',
          approvedBy: releaseRun.approvedBy,
          approvalSummary: releaseRun.approvalSummary,
          observations: {
            distribution: 'manual',
            repository: source.repository,
            branch: source.branch,
            acceptedCommit: source.acceptedCommit,
            confirmedBy: parsed.data.approvedBy,
            confirmation: parsed.data.summary,
          },
        });
        events.emit({ type: 'release.completed', projectId, projectName: project.name, occurredAt: evidence.recordedAt });
        return context.json({ releaseRun, evidence });
      } catch (error) {
        return context.json({ error: error instanceof Error ? error.message : 'Unable to approve a release.' }, 409);
      }
    }

    const composer = new ReleaseComposer({ workspacePath: run.workspacePath, projectName: projectSlug(project.name), source });
    let releaseRunId: string;
    try {
      const approved = await store.approveRelease(projectId, revision, {
        approvedBy: parsed.data.approvedBy,
        summary: parsed.data.summary,
        steps: composer.plan(),
      });
      releaseRunId = approved.id;
      events.emit({ type: 'release.approved', projectId, projectName: project.name, occurredAt: approved.createdAt });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : 'Unable to approve a release.' }, 409);
    }

    const outcome = await runRelease(projectId, project.name, revision, run.workspacePath, releaseRunId, source);
    return context.json(outcome, outcome.statusCode);
  });

  app.post('/api/projects/:projectId/release/retry', async context => {
    const projectId = context.req.param('projectId');
    const parsed = z.object({ confirmation: z.literal(CONFIRMATIONS.RETRY_RELEASE) }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Retrying a release requires confirmation RETRY_RELEASE.' }, 400);
    const resolved = await resolveReleaseContext(projectId);
    if ('error' in resolved) return context.json({ error: resolved.error }, resolved.statusCode);
    const { project, revision, run, workspace, source, sourceReason, manualDistribution } = resolved;
    if (!workspace.usable) return context.json({ error: workspace.reason, workspace }, 409);
    if (!source) return context.json({ error: sourceReason }, 409);
    if (manualDistribution) {
      return context.json({ error: 'A manual distribution release has no automated steps to retry; approve a new release instead.' }, 409);
    }
    const existing = store.getLatestReleaseRun(projectId, revision);
    if (!existing) return context.json({ error: 'No release run is available to retry.' }, 404);
    if (existing.status !== 'failed') return context.json({ error: 'Only a failed release can be retried.' }, 409);
    if (existing.attempts >= 3) return context.json({ error: 'Release retry limit reached; approve a new release instead.' }, 409);

    // The approval already happened; the retry resumes the approved release rather than opening a
    // second gate. RETRY returns the run to RELEASING because that is where it failed.
    await store.advanceDelivery(projectId, [{ type: 'RETRY' }]);
    await store.updateReleaseRun(existing.id, 'running', existing.steps.map(step => (step.status === 'failed' ? { ...step, status: 'pending' as const, detail: undefined } : step)), existing.attempts + 1);
    const outcome = await runRelease(projectId, project.name, revision, run.workspacePath, existing.id, source);
    return context.json(outcome, outcome.statusCode);
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
