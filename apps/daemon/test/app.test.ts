import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDevStore } from '@agent-dev/storage';
import type { AccountDiscoveryReport, ConnectorPreflightReport } from '@agent-dev/policy';
import { createDaemonApp } from '../src/app.js';

const directories: string[] = [];

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

    const approved = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/baseline-plan/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blueprintRevision: 1, confirmation: 'APPROVE_BASELINE' }),
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ approval: { status: 'approved', blueprintRevision: 1 }, plan: { noExternalChanges: true } });

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
    const invalidRetry = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/apply/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'RETRY_APPLY' }),
    });
    expect(invalidRetry.status).toBe(409);
    await store.close();
  }, 10_000);
});
