import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDevStore } from '@agent-dev/storage';
import type { AccountDiscoveryReport, ConnectorPreflightReport } from '@agent-dev/policy';
import { createDaemonApp } from '../src/app.js';

const directories: string[] = [];

const RELEASE_REPOSITORY = 'acme/receipt-desk';
const ACCEPTED_COMMIT = 'a'.repeat(40);

const RELEASE_SOURCE = {
  repository: RELEASE_REPOSITORY,
  branch: 'main',
  commit: 'b'.repeat(40),
  acceptedCommit: ACCEPTED_COMMIT,
};

// A production release is only allowed once a repository is recorded and a human accepted a commit,
// so a release test has to stand those two facts up rather than assume them.
async function recordReleasePrerequisites(workspacePath: string, options: { repository?: string; acceptance?: boolean } = {}) {
  const { repository = RELEASE_REPOSITORY, acceptance = true } = options;
  if (repository) {
    await mkdir(join(workspacePath, '.agent-dev'), { recursive: true });
    await writeFile(join(workspacePath, '.agent-dev', 'project-resources.json'), JSON.stringify({
      version: 1, projectName: 'Receipt Desk', projectId: 'project', blueprintRevision: 1,
      updatedAt: '2026-08-23T00:00:00.000Z', providers: { github: { repository } },
    }), 'utf8');
  }
  if (acceptance) {
    await writeFile(join(workspacePath, 'acceptance.json'), JSON.stringify({
      id: 'acceptance', projectId: 'project', blueprintRevision: 1, taskId: 'task',
      status: 'approved', criteriaConfirmed: true, summary: 'Accepted.', qualityStatus: 'passed',
      gitEvidence: { branch: 'feature/agent-dev/revision-1', head: ACCEPTED_COMMIT, status: '', diffStat: '' },
      submittedAt: '2026-08-23T00:00:00.000Z', approvedBy: 'test-user', approvedAt: '2026-08-23T00:00:00.000Z',
    }), 'utf8');
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('daemon API', () => {
  it('creates and lists persisted projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const report: ConnectorPreflightReport = {
      checkedAt: '2026-08-03T00:00:00.000Z',
      localOnly: true,
      readyForAccountDiscovery: false,
      connectors: [{
        id: 'github',
        title: 'GitHub',
        command: 'gh',
        status: 'available',
        version: 'gh 1.0.0',
        detail: 'Local command detected. Account authorization has not been checked.',
        nextAction: 'Authorize GitHub for account discovery.',
      }],
    };
    const accountReport: AccountDiscoveryReport = {
      checkedAt: '2026-08-05T00:00:00.000Z',
      readOnly: true,
      accounts: [{
        id: 'github', title: 'GitHub', status: 'authenticated', identity: 'octocat',
        detail: 'Read only.', nextAction: 'Choose an owner.',
      }],
    };
    const { app } = createDaemonApp(store, undefined, {
      runPreflight: async () => report,
      runAccountDiscovery: async () => accountReport,
    });

    const preflight = await app.request('http://localhost/api/connectors/preflight');
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toEqual(report);

    const discovery = await app.request('http://localhost/api/connectors/discovery');
    expect(discovery.status).toBe(200);
    await expect(discovery.json()).resolves.toEqual(accountReport);

    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', analyticsProviders: ['ga4'] },
      }),
    });
    expect(created.status).toBe(201);

    const createdPayload = await created.json() as { project: { id: string; blueprint: { metadata: { revision: number } } } };
    expect(createdPayload.project.blueprint.metadata.revision).toBe(1);

    const baseline = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan`);
    expect(baseline.status).toBe(200);
    await expect(baseline.json()).resolves.toMatchObject({ plan: { readyForApproval: false, noExternalChanges: true } });

    const dryRun = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/dry-run`);
    expect(dryRun.status).toBe(200);
    await expect(dryRun.json()).resolves.toMatchObject({
      plan: {
        noExternalChanges: true,
        artifacts: expect.arrayContaining([expect.objectContaining({ path: 'config/env.contract.yaml' })]),
      },
    });

    const revised = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/blueprint`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { mode: 'beginner', analyticsProviders: ['clarity'] } }),
    });
    expect(revised.status).toBe(200);
    await expect(revised.json()).resolves.toMatchObject({
      project: { blueprint: { metadata: { revision: 2 }, spec: { analytics: { providers: ['clarity'] } } } },
    });

    const listed = await app.request('http://localhost/api/projects');
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      projects: [{ name: 'Receipt Desk', state: 'NEEDS_INPUT' }],
    });
    await store.close();
  });

  it('requires explicit confirmation before recording a ready baseline approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store);
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ready Baseline',
        answers: {
          mode: 'professional',
          githubOwner: 'acme',
          supabaseOrganization: 'acme',
          vercelTeam: 'acme',
          cloudflareAccount: 'acme',
        },
      }),
    });
    const createdPayload = await created.json() as { project: { id: string } };

    const missingConfirmation = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1 }),
    });
    expect(missingConfirmation.status).toBe(400);

    const beforeApproval = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    expect(beforeApproval.status).toBe(409);

    // An approval nobody is named on cannot be traced to a person, so there is no default identity.
    const anonymous = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE' }),
    });
    expect(anonymous.status).toBe(400);
    await expect(anonymous.json()).resolves.toMatchObject({ error: expect.stringContaining('name of who approves it') });

    const approved = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ approval: { status: 'approved', blueprintRevision: 1, approvedBy: 'test-user' }, plan: { noExternalChanges: true } });

    const plan = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan`);
    await expect(plan.json()).resolves.toMatchObject({ approval: { status: 'approved' } });

    const providerPlan = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/provider-plan`);
    expect(providerPlan.status).toBe(200);
    await expect(providerPlan.json()).resolves.toMatchObject({ noExternalChanges: true, plans: expect.arrayContaining([expect.objectContaining({ providerId: 'github', noExternalChanges: true })]) });

    const providerApply = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/provider-plan/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPLY_FAKE_PROVIDERS' }),
    });
    expect(providerApply.status).toBe(200);

    const providerVerify = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/provider-plan/verify`);
    await expect(providerVerify.json()).resolves.toMatchObject({ verified: true, deliveryReport: expect.stringContaining('Provider Simulation Report'), unifiedDeliveryReport: expect.stringContaining('Local Apply') });

    const applied = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({ run: { status: 'completed', steps: expect.arrayContaining([expect.objectContaining({ status: 'completed' })]) } });
    const dependencies = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/dependencies`);
    expect(dependencies.status).toBe(200);
    await expect(dependencies.json()).resolves.toMatchObject({ readiness: { status: 'missing-dependencies', qualityCommandPresent: false } });
    const missingInstallConfirmation = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/dependencies/install`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1 }),
    });
    expect(missingInstallConfirmation.status).toBe(400);
    const quality = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/quality-gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'RUN_QUALITY_GATE' }),
    });
    expect(quality.status).toBe(422);
    await expect(quality.json()).resolves.toMatchObject({ result: { status: 'failed', command: 'npm run quality' } });
    const latestQuality = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/quality-gate`);
    await expect(latestQuality.json()).resolves.toMatchObject({ result: { status: 'failed' } });
    const task = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/feature-task`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, title: 'Add receipt list', objective: 'Show saved receipts to the user.', acceptanceCriteria: ['The list renders saved receipts.'] }),
    });
    expect(task.status).toBe(201);
    await expect(task.json()).resolves.toMatchObject({ task: { status: 'draft', title: 'Add receipt list' } });
    const approvedTask = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/feature-task/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_FEATURE_TASK', approvedBy: 'test-user' }),
    });
    expect(approvedTask.status).toBe(200);
    await expect(approvedTask.json()).resolves.toMatchObject({ task: { status: 'approved', approvedBy: 'test-user' } });
    const runtimePlan = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/runtime/plan`);
    expect(runtimePlan.status).toBe(200);
    await expect(runtimePlan.json()).resolves.toMatchObject({ plan: { mode: 'dry-run', executionAllowed: false, noExternalChanges: true }, probe: { executionVerified: false } });
    const catalog = await app.request('http://localhost/api/runtime/catalog');
    expect(catalog.status).toBe(200);
    // The catalog only reports built-ins actually present on PATH, so asserting a specific Agent
    // would only pass on a machine that happens to have it installed. The contract is the shape.
    const catalogPayload = await catalog.json() as { agents: { source: string; detected: boolean; launchCommand: string }[] };
    expect(Array.isArray(catalogPayload.agents)).toBe(true);
    expect(catalogPayload.agents.every(agent => agent.detected && agent.launchCommand.length > 0)).toBe(true);
    expect(catalogPayload.agents.every(agent => agent.source === 'built-in')).toBe(true);
    const customAgent = await app.request('http://localhost/api/runtime/catalog', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Node Fixture', launchCommand: 'node' }),
    });
    expect(customAgent.status).toBe(201);
    await expect(customAgent.json()).resolves.toMatchObject({ agent: { source: 'custom', name: 'Node Fixture', detected: true } });
    const runtimeRun = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/runtime/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'PREPARE_RUNTIME_RUN' }),
    });
    expect(runtimeRun.status).toBe(201);
    await expect(runtimeRun.json()).resolves.toMatchObject({ run: { status: 'planned' } });
    const runtimeEvidence = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/runtime/evidence`);
    await expect(runtimeEvidence.json()).resolves.toMatchObject({ evidence: { branch: 'feature/agent-dev/revision-1' } });
    const runtimeCancel = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/runtime/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'CANCEL_RUNTIME_RUN' }),
    });
    await expect(runtimeCancel.json()).resolves.toMatchObject({ run: { status: 'cancelled' } });
    const acceptance = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/acceptance`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'The task is ready for review.', criteriaConfirmed: true }),
    });
    expect(acceptance.status).toBe(422);
    await expect(acceptance.json()).resolves.toMatchObject({ acceptance: { status: 'blocked', qualityStatus: 'failed' } });
    const finalReport = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/delivery-report`);
    expect(finalReport.status).toBe(200);
    await expect(finalReport.json()).resolves.toMatchObject({ report: expect.stringContaining('# Ready Baseline Final Delivery Report') });
    const blockedApproval = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/acceptance/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPROVE_DELIVERY', approvedBy: 'test-user' }),
    });
    expect(blockedApproval.status).toBe(409);
    const invalidRetry = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/apply/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'RETRY_APPLY' }),
    });
    expect(invalidRetry.status).toBe(409);
    await store.close();
  }, 30_000);

  it('cleans a PR preview only after verifying a signed GitHub close event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const cleanupCalls: { vercelProject?: string; cloudflareProject?: string; workspacePath: string }[] = [];
    const { app } = createDaemonApp(store, undefined, {
      resolveGitHubWebhookSecret: () => 'webhook-secret',
      cleanupPreview: async options => {
        cleanupCalls.push(options);
        return { vercel: true, cloudflare: true, errors: [] };
      },
    });
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });

    const body = JSON.stringify({ action: 'closed', repository: { name: 'receipt-desk' }, pull_request: { number: 42 } });
    const signature = `sha256=${createHmac('sha256', 'webhook-secret').update(body).digest('hex')}`;
    const cleaned = await app.request('http://localhost/api/github/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': signature },
      body,
    });
    expect(cleaned.status).toBe(200);
    await expect(cleaned.json()).resolves.toMatchObject({ projectId: project.id, previewBranch: 'pr-42', cleanup: { errors: [] } });
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]).toMatchObject({ vercelProject: 'receipt-desk-api-pr-42', cloudflareProject: 'receipt-desk-web-pr-42' });

    const rejected = await app.request('http://localhost/api/github/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=invalid' },
      body,
    });
    expect(rejected.status).toBe(401);
    expect(cleanupCalls).toHaveLength(1);

    const ignored = await app.request('http://localhost/api/github/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push' },
      body: '{}',
    });
    expect(ignored.status).toBe(202);
    expect(cleanupCalls).toHaveLength(1);
    await store.close();
  }, 30_000);

  it('derives provider project names from a slug that Vercel and Cloudflare accept', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store);
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk (2026)!',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });

    // The raw name would produce an invalid provider project name: spaces, parentheses,
    // punctuation and a trailing separator are all rejected by both providers.
    const plan = await app.request(`http://localhost/api/projects/${project.id}/preview/plan`);
    const planPayload = await plan.json() as { idempotencyKey: string };
    expect(planPayload.idempotencyKey).toBe('preview:receipt-desk-2026:preview');
    await store.close();
  }, 30_000);

  // The composer's pipeline is Vercel-then-Cloudflare over `apps/api` and `apps/web`. An api-tool
  // scaffold generates neither, so without a guard the route would try to deploy directories that
  // are not there, after already recording a Vercel project as possibly created.
  it('refuses a hosted preview for a product type that deploys nowhere', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store);
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'MCP Word Tools', answers: { mode: 'professional', productType: 'api-tool', githubOwner: 'acme' } }),
    });
    const { project } = await created.json() as { project: { id: string } };

    const baseline = await app.request(`http://localhost/api/projects/${project.id}/baseline-plan`);
    const baselinePayload = await baseline.json() as { plan: { readyForApproval: boolean; resources: { id: string }[] } };
    expect(baselinePayload.plan.resources.map(resource => resource.id)).toEqual(['github-repository']);
    expect(baselinePayload.plan.readyForApproval).toBe(true);

    const plan = await app.request(`http://localhost/api/projects/${project.id}/preview/plan`);
    expect(plan.status).toBe(409);
    expect((await plan.json() as { error: string }).error).toContain('no hosted deployment target');

    const release = await app.request(`http://localhost/api/projects/${project.id}/release/plan`);
    expect(release.status).toBe(409);
    await store.close();
  }, 30_000);

  it('recovers a stale workspace into a clean one and leaves the old one on disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store);
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    const applied = await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    const { run: firstRun } = await applied.json() as { run: { id: string; workspacePath: string } };

    const badConfirmation = await app.request(`http://localhost/api/projects/${project.id}/apply/recover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RECOVER' }),
    });
    expect(badConfirmation.status).toBe(400);

    // A healthy workspace is not a recovery case: nothing has gone wrong to recover from.
    const refused = await app.request(`http://localhost/api/projects/${project.id}/apply/recover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RECOVER_WORKSPACE' }),
    });
    expect(refused.status).toBe(409);

    // Simulate the workspace an older generator produced: deployment configuration content drifts.
    await writeFile(join(firstRun.workspacePath, '.github/workflows/quality.yml'), 'name: stale\n', 'utf8');
    const recovered = await app.request(`http://localhost/api/projects/${project.id}/apply/recover`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RECOVER_WORKSPACE' }),
    });
    expect(recovered.status).toBe(200);
    const payload = await recovered.json() as {
      run: { id: string; workspacePath: string; recoveryIndex: number; status: string };
      abandoned: { workspacePath: string; git: { branch: string } | null; workspace: { staleConfig: string[] } };
    };
    expect(payload.run.id).not.toBe(firstRun.id);
    expect(payload.run.status).toBe('completed');
    expect(payload.run.recoveryIndex).toBe(1);
    expect(payload.run.workspacePath).toContain('revision-1-recovery-1');
    expect(payload.abandoned.workspacePath).toBe(firstRun.workspacePath);
    expect(payload.abandoned.workspace.staleConfig).toContain('.github/workflows/quality.yml');
    expect(payload.abandoned.git?.branch).toBe('feature/agent-dev/revision-1');

    // The old workspace is kept exactly as it was so its failure stays inspectable.
    await expect(readFile(join(firstRun.workspacePath, '.github/workflows/quality.yml'), 'utf8')).resolves.toBe('name: stale\n');
    await expect(readFile(join(payload.run.workspacePath, '.github/workflows/quality.yml'), 'utf8')).resolves.toContain('actions/checkout@v5');
    await store.close();
  }, 30_000);
  it('requires a separate request and approval before any production deploy runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const releaseCalls: { workspacePath: string; projectName: string; source: unknown }[] = [];
    const { app } = createDaemonApp(store, undefined, {
      deployRelease: async options => {
        releaseCalls.push(options);
        return {
          status: 'completed',
          steps: [{ id: 'verify-release-quality', title: 'Verify release quality gate', status: 'completed' }],
          apiBaseUrl: 'https://receipt-desk-api.vercel.app',
          webUrl: 'https://receipt-desk-web.pages.dev',
          corsOrigin: 'https://receipt-desk-web.pages.dev',
          observations: {
            source: RELEASE_SOURCE,
            releaseQuality: { command: 'npm run quality', exitCode: 0 },
            apiHealth: { url: 'https://receipt-desk-api.vercel.app/api/health', httpStatus: 200, contentType: 'application/json', observedCorsHeader: 'https://receipt-desk-web.pages.dev' },
            webPage: { url: 'https://receipt-desk-web.pages.dev', httpStatus: 200, sourceBytes: 128, matchedApiBaseUrl: 'https://receipt-desk-api.vercel.app' },
            productionSmoke: { apiHealthUrl: 'https://receipt-desk-api.vercel.app/api/health', apiHttpStatus: 200, observedCorsHeader: 'https://receipt-desk-web.pages.dev' },
          },
        };
      },
    });
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    const applied = await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    const { run } = await applied.json() as { run: { workspacePath: string } };

    const plan = await app.request(`http://localhost/api/projects/${project.id}/release/plan`);
    expect(plan.status).toBe(200);
    await expect(plan.json()).resolves.toMatchObject({
      idempotencyKey: 'release:receipt-desk:production',
      corsOrigin: 'https://receipt-desk-web.pages.dev',
      productionApproval: 'required',
      releaseRun: null,
      // Nothing has been applied to a real GitHub account, so there is no production branch to
      // release from and the plan says so instead of pretending it could deploy.
      source: null,
      sourceReason: expect.stringContaining('No repository is recorded'),
    });

    // Approval cannot be reached without a request first, and neither can deploy anything on its own.
    const prematureApproval = await app.request(`http://localhost/api/projects/${project.id}/release/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', approvedBy: 'test-user', summary: 'Ship revision 1.' }),
    });
    expect(prematureApproval.status).toBe(409);
    expect(releaseCalls).toHaveLength(0);

    // The project has to be at PREVIEW_READY for a release request; nothing else may skip ahead.
    const prematureRequest = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(prematureRequest.status).toBe(409);
    expect(releaseCalls).toHaveLength(0);

    await store.advanceDelivery(project.id, [
      { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
      { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' }, { type: 'PREVIEW_AVAILABLE' },
    ]);

    const requested = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    // Reaching PREVIEW_READY is not enough: without a repository there is no production branch to
    // release from, so the request is refused before a human is asked to approve anything.
    expect(requested.status).toBe(409);
    await expect(requested.json()).resolves.toMatchObject({ error: expect.stringContaining('No repository is recorded') });

    // A recorded repository is not enough either: production must carry a commit a human accepted.
    await recordReleasePrerequisites(run.workspacePath, { acceptance: false });
    const withoutAcceptance = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(withoutAcceptance.status).toBe(409);
    await expect(withoutAcceptance.json()).resolves.toMatchObject({ error: expect.stringContaining('Approve the delivery') });
    expect(releaseCalls).toHaveLength(0);

    await recordReleasePrerequisites(run.workspacePath);
    const readyRequest = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(readyRequest.status).toBe(200);
    await expect(readyRequest.json()).resolves.toMatchObject({ state: 'AWAITING_APPROVAL' });
    expect(releaseCalls).toHaveLength(0);

    const missingApprover = await app.request(`http://localhost/api/projects/${project.id}/release/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', summary: 'Ship revision 1.' }),
    });
    expect(missingApprover.status).toBe(400);
    expect(releaseCalls).toHaveLength(0);

    const approved = await app.request(`http://localhost/api/projects/${project.id}/release/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', approvedBy: 'test-user', summary: 'Ship revision 1.' }),
    });
    expect(approved.status).toBe(200);
    // The release is handed the production branch of the recorded repository and the accepted commit,
    // not just the local workspace the feature was implemented in.
    expect(releaseCalls).toEqual([{
      workspacePath: expect.stringContaining('revision-1'),
      projectName: 'receipt-desk',
      source: {
        repository: RELEASE_REPOSITORY,
        branch: 'main',
        acceptedCommit: ACCEPTED_COMMIT,
        checkoutPath: expect.stringContaining(join('releases', project.id, 'main')),
      },
    }]);
    await expect(approved.json()).resolves.toMatchObject({
      releaseRun: { status: 'completed', approvedBy: 'test-user' },
      evidence: { webUrl: 'https://receipt-desk-web.pages.dev', approvedBy: 'test-user' },
    });

    const state = await app.request(`http://localhost/api/projects/${project.id}/release`);
    await expect(state.json()).resolves.toMatchObject({
      state: 'DELIVERED',
      releaseRun: { status: 'completed' },
      evidence: { observations: { releaseQuality: { exitCode: 0 } } },
    });
    await store.close();
  }, 30_000);

  it('journals a failed release and lets the retry resume the approved release', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    let attempt = 0;
    const { app } = createDaemonApp(store, undefined, {
      deployRelease: async () => {
        attempt += 1;
        if (attempt === 1) {
          return {
            status: 'failed',
            steps: [
              { id: 'verify-release-quality', title: 'Verify release quality gate', status: 'completed' },
              { id: 'deploy-api-production', title: 'Deploy production API', status: 'failed', detail: 'vercel deploy failed' },
            ],
            corsOrigin: 'https://receipt-desk-web.pages.dev',
          };
        }
        return {
          status: 'completed',
          steps: [
            { id: 'verify-release-quality', title: 'Verify release quality gate', status: 'completed' },
            { id: 'deploy-api-production', title: 'Deploy production API', status: 'completed' },
          ],
          apiBaseUrl: 'https://receipt-desk-api.vercel.app',
          webUrl: 'https://receipt-desk-web.pages.dev',
          corsOrigin: 'https://receipt-desk-web.pages.dev',
          observations: {
            source: RELEASE_SOURCE,
            releaseQuality: { command: 'npm run quality', exitCode: 0 },
            apiHealth: { url: 'https://receipt-desk-api.vercel.app/api/health', httpStatus: 200, contentType: 'application/json', observedCorsHeader: 'https://receipt-desk-web.pages.dev' },
            webPage: { url: 'https://receipt-desk-web.pages.dev', httpStatus: 200, sourceBytes: 128, matchedApiBaseUrl: 'https://receipt-desk-api.vercel.app' },
            productionSmoke: { apiHealthUrl: 'https://receipt-desk-api.vercel.app/api/health', apiHttpStatus: 200, observedCorsHeader: 'https://receipt-desk-web.pages.dev' },
          },
        };
      },
    });
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    const applied = await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    const { run } = await applied.json() as { run: { workspacePath: string } };
    await recordReleasePrerequisites(run.workspacePath);
    await store.advanceDelivery(project.id, [
      { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
      { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' }, { type: 'PREVIEW_AVAILABLE' },
    ]);
    await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });

    const failed = await app.request(`http://localhost/api/projects/${project.id}/release/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', approvedBy: 'test-user', summary: 'Ship revision 1.' }),
    });
    expect(failed.status).toBe(422);
    await expect(failed.json()).resolves.toMatchObject({ releaseRun: { status: 'failed' } });
    expect(store.getProject(project.id)?.state).toBe('FAILED');
    await expect(store.getReleaseEvidence(project.id, 1)).resolves.toBeNull();

    const retried = await app.request(`http://localhost/api/projects/${project.id}/release/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RETRY_RELEASE' }),
    });
    expect(retried.status).toBe(200);
    // The retry resumes the approved release: the same journal row, no second approval gate.
    await expect(retried.json()).resolves.toMatchObject({ releaseRun: { status: 'completed', attempts: 1, approvedBy: 'test-user' } });
    expect(store.getProject(project.id)?.state).toBe('DELIVERED');

    const again = await app.request(`http://localhost/api/projects/${project.id}/release/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RETRY_RELEASE' }),
    });
    expect(again.status).toBe(409);
    await store.close();
  }, 30_000);

  it('delivers a product without a hosted deployment target through a manually confirmed distribution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const releaseCalls: unknown[] = [];
    const { app } = createDaemonApp(store, undefined, {
      deployRelease: async options => {
        releaseCalls.push(options);
        throw new Error('A manual distribution must not trigger a deploy.');
      },
    });
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Rules',
        answers: { mode: 'professional', productType: 'api-tool', githubOwner: 'acme' },
      }),
    });
    expect(created.status).toBe(201);
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    const applied = await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    expect(applied.status).toBe(200);
    const { run } = await applied.json() as { run: { workspacePath: string } };

    // A manual-distribution product sees a single confirmation step and no production origin.
    const plan = await app.request(`http://localhost/api/projects/${project.id}/release/plan`);
    expect(plan.status).toBe(200);
    const planPayload = await plan.json() as { manualDistribution: boolean; corsOrigin?: string; steps: { id: string }[]; source: unknown };
    expect(planPayload).toMatchObject({
      manualDistribution: true,
      steps: [{ id: 'confirm-manual-distribution' }],
      source: null,
    });
    expect(planPayload.corsOrigin).toBeUndefined();

    await store.advanceDelivery(project.id, [
      { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
      { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' },
    ]);

    // The same prerequisites as a hosted release: a recorded repository and an accepted commit.
    const withoutSource = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(withoutSource.status).toBe(409);
    await expect(withoutSource.json()).resolves.toMatchObject({ error: expect.stringContaining('No repository is recorded') });

    await recordReleasePrerequisites(run.workspacePath);
    const requested = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(requested.status).toBe(200);
    await expect(requested.json()).resolves.toMatchObject({ state: 'AWAITING_APPROVAL' });

    const approved = await app.request(`http://localhost/api/projects/${project.id}/release/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', approvedBy: 'test-user', summary: 'Distribute revision 1.' }),
    });
    expect(approved.status).toBe(200);
    // Nothing was deployed: the run completes by journalling the confirmation, no provider call.
    expect(releaseCalls).toHaveLength(0);
    await expect(approved.json()).resolves.toMatchObject({
      releaseRun: { status: 'completed', approvedBy: 'test-user', steps: [{ id: 'confirm-manual-distribution', status: 'completed', detail: 'Distribute revision 1.' }] },
      evidence: {
        distribution: 'manual',
        approvedBy: 'test-user',
        observations: { distribution: 'manual', repository: RELEASE_REPOSITORY, branch: 'main', acceptedCommit: ACCEPTED_COMMIT },
      },
    });

    const state = await app.request(`http://localhost/api/projects/${project.id}/release`);
    await expect(state.json()).resolves.toMatchObject({ state: 'DELIVERED', releaseRun: { status: 'completed' } });

    // A manual distribution has no automated steps, so there is nothing a retry could resume.
    const retried = await app.request(`http://localhost/api/projects/${project.id}/release/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RETRY_RELEASE' }),
    });
    expect(retried.status).toBe(409);
    await store.close();
  }, 30_000);

  it('keeps hosted products on the preview gate before a release request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store, undefined, {
      deployRelease: async () => { throw new Error('The preview-first guard must stop before any deploy.'); },
    });
    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' },
      }),
    });
    const { project } = await created.json() as { project: { id: string } };
    await app.request(`http://localhost/api/projects/${project.id}/baseline-plan/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE', approvedBy: 'test-user' }),
    });
    const applied = await app.request(`http://localhost/api/projects/${project.id}/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPLY_BASELINE' }),
    });
    const { run } = await applied.json() as { run: { workspacePath: string } };
    await recordReleasePrerequisites(run.workspacePath);
    await store.advanceDelivery(project.id, [
      { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
      { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' },
    ]);

    // The PR_OPEN shortcut exists only for products without a hosted deployment target: a hosted
    // product with a recorded repository and accepted commit still cannot skip the preview gate.
    const premature = await app.request(`http://localhost/api/projects/${project.id}/release/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
    });
    expect(premature.status).toBe(409);
    await expect(premature.json()).resolves.toMatchObject({ error: expect.stringContaining('preview gate') });
    expect(store.getProject(project.id)?.state).toBe('PR_OPEN');
    await store.close();
  }, 30_000);

  describe('agent profile API', () => {
    async function openProfileStore() {
      const directory = await mkdtemp(join(tmpdir(), 'agent-dev-profiles-'));
      directories.push(directory);
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const { app } = createDaemonApp(store, undefined, {});
      return { store, app };
    }

    const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    it('creates, lists, reads, updates and deletes a profile', async () => {
      const { store, app } = await openProfileStore();
      try {
        const created = await app.request('http://localhost/api/runtime/profiles', json({
          name: 'Frontend Expert', baseAgentId: 'codex',
          overrides: { temperature: 0.3, systemPrompt: 'You are a React expert.' },
        }));
        expect(created.status).toBe(201);
        const { profile } = await created.json() as { profile: { id: string; baseAgentId: string; overrides: { temperature: number; systemPrompt: string } } };
        expect(profile.id).toBe('frontend-expert');
        expect(profile.baseAgentId).toBe('codex');

        const list = await app.request('http://localhost/api/runtime/profiles');
        expect(list.status).toBe(200);
        await expect(list.json()).resolves.toMatchObject({ profiles: [expect.objectContaining({ id: 'frontend-expert' })] });

        const get = await app.request('http://localhost/api/runtime/profiles/frontend-expert');
        expect(get.status).toBe(200);
        await expect(get.json()).resolves.toMatchObject({ profile: expect.objectContaining({ name: 'Frontend Expert' }) });

        const updated = await app.request('http://localhost/api/runtime/profiles/frontend-expert', {
          ...json({ name: 'Frontend Expert v2' }), method: 'PUT',
        });
        expect(updated.status).toBe(200);
        await expect(updated.json()).resolves.toMatchObject({ profile: expect.objectContaining({ name: 'Frontend Expert v2' }) });

        const deleted = await app.request('http://localhost/api/runtime/profiles/frontend-expert', { method: 'DELETE' });
        expect(deleted.status).toBe(200);
        await expect(deleted.json()).resolves.toEqual({ deleted: true });

        expect((await app.request('http://localhost/api/runtime/profiles/frontend-expert')).status).toBe(404);
      } finally {
        await store.close();
      }
    });

    it('assigns a unique id when a slug is already taken', async () => {
      const { store, app } = await openProfileStore();
      try {
        const first = await app.request('http://localhost/api/runtime/profiles', json({ name: 'Codex Expert', baseAgentId: 'codex' }));
        expect(first.status).toBe(201);
        const second = await app.request('http://localhost/api/runtime/profiles', json({ name: 'Codex Expert', baseAgentId: 'codex' }));
        expect(second.status).toBe(201);
        await expect(second.json()).resolves.toMatchObject({ profile: expect.objectContaining({ id: 'codex-expert-2' }) });
      } finally {
        await store.close();
      }
    });

    it('rejects a profile whose base agent is not verified', async () => {
      const { store, app } = await openProfileStore();
      try {
        const res = await app.request('http://localhost/api/runtime/profiles', json({ name: 'Claude Variant', baseAgentId: 'claude-code' }));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('not verified') });
      } finally {
        await store.close();
      }
    });

    it('rejects unsafe env keys during creation', async () => {
      const { store, app } = await openProfileStore();
      try {
        const res = await app.request('http://localhost/api/runtime/profiles', json({ name: 'Unsafe', baseAgentId: 'codex', overrides: { env: { DATABASE_URL: 'postgres://x' } } }));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ details: expect.arrayContaining([expect.stringContaining('Unsafe environment variable keys')]) });
      } finally {
        await store.close();
      }
    });

    it('rejects invalid create input', async () => {
      const { store, app } = await openProfileStore();
      try {
        const res = await app.request('http://localhost/api/runtime/profiles', json({ name: '', baseAgentId: 'codex' }));
        expect(res.status).toBe(400);
      } finally {
        await store.close();
      }
    });

    it('returns 404 for reads, updates and deletes of a missing profile', async () => {
      const { store, app } = await openProfileStore();
      try {
        expect((await app.request('http://localhost/api/runtime/profiles/nope')).status).toBe(404);
        const update = await app.request('http://localhost/api/runtime/profiles/nope', { ...json({ name: 'X' }), method: 'PUT' });
        expect(update.status).toBe(404);
        expect((await app.request('http://localhost/api/runtime/profiles/nope', { method: 'DELETE' })).status).toBe(404);
      } finally {
        await store.close();
      }
    });
  });
  describe('daemon token auth', () => {
    const TOKEN = 'test-daemon-token';

    async function openAuthedStore() {
      const directory = await mkdtemp(join(tmpdir(), 'agent-dev-auth-'));
      directories.push(directory);
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const { app } = createDaemonApp(store, undefined, {}, undefined, { authToken: TOKEN });
      return { store, app };
    }

    const authed = (init: RequestInit = {}) => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}` } });

    it('rejects /api/* without a token, with a wrong token, and with a malformed header', async () => {
      const { store, app } = await openAuthedStore();
      try {
        expect((await app.request('http://localhost/api/projects')).status).toBe(401);
        expect((await app.request('http://localhost/api/projects', { headers: { authorization: 'Bearer wrong-token' } })).status).toBe(401);
        expect((await app.request('http://localhost/api/projects', { headers: { authorization: TOKEN } })).status).toBe(401);
      } finally {
        await store.close();
      }
    });

    it('admits /api/* requests carrying the correct bearer token', async () => {
      const { store, app } = await openAuthedStore();
      try {
        const response = await app.request('http://localhost/api/projects', authed());
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ projects: [] });
      } finally {
        await store.close();
      }
    });

    it('keeps credential and secret routes behind the token (S4 regression)', async () => {
      const { store, app } = await openAuthedStore();
      try {
        expect((await app.request('http://localhost/api/credentials')).status).toBe(401);
        expect((await app.request('http://localhost/api/secret-backend/keys')).status).toBe(401);
      } finally {
        await store.close();
      }
    });

    it('exempts /api/health from the token check', async () => {
      const { store, app } = await openAuthedStore();
      try {
        const response = await app.request('http://localhost/api/health');
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
      } finally {
        await store.close();
      }
    });

    it('exempts the GitHub webhook route from the bearer check (it authenticates by HMAC signature)', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'agent-dev-auth-'));
      directories.push(directory);
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const { app } = createDaemonApp(store, undefined, { resolveGitHubWebhookSecret: () => 'test-webhook-secret' }, undefined, { authToken: TOKEN });
      try {
        const body = '{}';
        const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body).digest('hex')}`;
        // A signed webhook without a bearer token passes the token gate; the payload then fails
        // schema validation and is ignored with 202. The 401 path of this route means a bad
        // signature, never a missing bearer token.
        const response = await app.request('http://localhost/api/github/webhooks', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': signature }, body,
        });
        expect(response.status).toBe(202);
      } finally {
        await store.close();
      }
    });
  });

  describe('daemon token file', () => {
    it('creates the token once with user-only permissions and reuses it on later starts', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'agent-dev-token-'));
      directories.push(directory);
      const tokenPath = join(directory, 'daemon-token');
      const previous = process.env.AGENT_DEV_DAEMON_TOKEN_PATH;
      process.env.AGENT_DEV_DAEMON_TOKEN_PATH = tokenPath;
      try {
        const { loadOrCreateDaemonToken } = await import('../src/auth.js');
        const first = loadOrCreateDaemonToken();
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect((await readFile(tokenPath, 'utf8')).trim()).toBe(first);
        // A daemon restart must reuse the same token: Studio and the MCP bridge cache it at startup.
        expect(loadOrCreateDaemonToken()).toBe(first);
      } finally {
        if (previous === undefined) delete process.env.AGENT_DEV_DAEMON_TOKEN_PATH;
        else process.env.AGENT_DEV_DAEMON_TOKEN_PATH = previous;
      }
    });
  });
});
