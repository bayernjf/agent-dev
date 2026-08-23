import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createBlueprint, createDefaultBlueprint } from '@agent-dev/blueprint';
import { AgentDevStore } from '../src/index.js';

const execFileAsync = promisify(execFile);

describe('AgentDevStore', () => {
  it('persists a project, its initial blueprint revision, and a delivery run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Receipt Desk',
        blueprint: createDefaultBlueprint('receipt-desk'),
      });
      await store.close();

      const reopened = await AgentDevStore.open(databasePath);
      expect(reopened.listProjects()).toHaveLength(1);
      expect(reopened.getProject(created.id)?.state).toBe('NEEDS_INPUT');
      expect(reopened.getProject(created.id)?.blueprint.metadata.name).toBe('receipt-desk');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds a Blueprint revision instead of overwriting project history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Receipt Desk',
        blueprint: createDefaultBlueprint('receipt-desk'),
      });
      const revised = await store.reviseProjectBlueprint(created.id, createBlueprint('receipt-desk', {
        mode: 'professional',
        analyticsProviders: ['clarity'],
      }, 2));

      expect(revised.blueprint.metadata.revision).toBe(2);
      expect(revised.blueprint.spec.analytics.providers).toEqual(['clarity']);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('records a baseline approval for the exact Blueprint revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Approved Baseline',
        blueprint: createBlueprint('approved-baseline', {
          mode: 'professional',
          githubOwner: 'acme',
          supabaseOrganization: 'acme',
          vercelTeam: 'acme',
          cloudflareAccount: 'acme',
        }),
      });

      const approval = await store.approveBaseline(created.id, 1, 'test-user');
      expect(approval).toMatchObject({ projectId: created.id, blueprintRevision: 1, status: 'approved', approvedBy: 'test-user' });
      expect(store.getBaselineApproval(created.id, 1)).toEqual(approval);
      expect(store.getProject(created.id)?.state).toBe('PROVISIONING');

      await store.close();
      const reopened = await AgentDevStore.open(databasePath);
      expect(reopened.getBaselineApproval(created.id, 1)).toEqual(approval);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs the local Apply Simulator without provider writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Local Apply',
        blueprint: createBlueprint('local-apply', {
          mode: 'professional',
          githubOwner: 'acme',
          supabaseOrganization: 'acme',
          vercelTeam: 'acme',
          cloudflareAccount: 'acme',
        }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const queued = await store.createApplyRun(created.id, 1);
      const completed = await store.executeApplyRun(queued.id);

      expect(completed.status).toBe('completed');
      expect(completed.attempts).toBe(1);
      expect(completed.steps.every(step => step.status === 'completed')).toBe(true);
      expect(store.getProject(created.id)?.state).toBe('BASELINE_READY');
      await expect(store.executeApplyRun(queued.id)).resolves.toMatchObject({ id: queued.id, status: 'completed', attempts: 1 });
      await expect(readFile(join(completed.workspacePath, 'apply-manifest.json'), 'utf8')).resolves.toContain('No provider resource was created');
      await expect(readFile(join(completed.workspacePath, 'DELIVERY_REPORT.md'), 'utf8')).resolves.toContain('External writes: none');
      await expect(readFile(join(completed.workspacePath, 'generated', 'AGENTS.md'), 'utf8')).resolves.toContain('Agent Execution Constraints');
      await expect(readFile(join(completed.workspacePath, 'apps', 'web', 'src', 'main.tsx'), 'utf8')).resolves.toContain('createRoot');
      await expect(readFile(join(completed.workspacePath, 'apps', 'api', 'src', 'index.ts'), 'utf8')).resolves.toContain('/api/health');
      await expect(readFile(join(completed.workspacePath, 'tsconfig.json'), 'utf8')).resolves.toContain('react-jsx');
      await expect(readFile(join(completed.workspacePath, '.git', 'HEAD'), 'utf8')).resolves.toContain('refs/heads/feature/agent-dev/revision-1');
      await expect(readFile(join(completed.workspacePath, 'apply-manifest.json'), 'utf8')).resolves.toMatch(/"featureBranch": "feature\/agent-dev\/revision-1"/);
      await expect(readFile(join(completed.workspacePath, 'DELIVERY_REPORT.md'), 'utf8')).resolves.toContain('Local feature branch: feature/agent-dev/revision-1');
      const quality = await store.runQualityGate(created.id, 1);
      expect(quality.status).toBe('failed');
      expect(quality.command).toBe('npm run quality');
      await expect(store.getDependencyReadiness(created.id, 1)).resolves.toMatchObject({ status: 'missing-dependencies', packageLockPresent: false, qualityCommandPresent: false });
      await expect(store.getQualityGateResult(created.id, 1)).resolves.toMatchObject({ status: 'failed', command: 'npm run quality' });
      await expect(readFile(join(completed.workspacePath, 'quality-gate.json'), 'utf8')).resolves.toContain('"status": "failed"');
      await expect(readFile(join(completed.workspacePath, 'QUALITY_REPORT.md'), 'utf8')).resolves.toContain('# Quality Gate Report');
      const task = await store.createFeatureTask({ projectId: created.id, blueprintRevision: 1, title: 'Add receipt list', objective: 'Show the user a list of saved receipts.', acceptanceCriteria: ['The list renders saved receipts.', 'Empty state is visible when there are no receipts.'] });
      expect(task.status).toBe('draft');
      const approvedTask = await store.approveFeatureTask(created.id, 1, 'test-user');
      expect(approvedTask).toMatchObject({ status: 'approved', approvedBy: 'test-user' });
      expect(store.getProject(created.id)?.state).toBe('IMPLEMENTING');
      await expect(readFile(join(completed.workspacePath, 'FEATURE_TASK.md'), 'utf8')).resolves.toContain('The list renders saved receipts.');
      await expect(readFile(join(completed.workspacePath, 'TASK_APPROVAL.md'), 'utf8')).resolves.toContain('Approved by: test-user');
      const runtimeRun = await store.prepareRuntimeRun(created.id, 1);
      expect(runtimeRun).toMatchObject({ status: 'planned', plan: { mode: 'dry-run', executionAllowed: false } });
      expect(runtimeRun.agentId).toBe('codex');
      await expect(readFile(join(completed.workspacePath, 'RUNTIME_RUN_REPORT.md'), 'utf8')).resolves.toContain('- Agent: codex');
      await expect(readFile(join(completed.workspacePath, 'RUNTIME_RUN_REPORT.md'), 'utf8')).resolves.toContain('No Codex process was started');
      const evidence = await store.getGitEvidence(created.id, 1);
      expect(evidence.branch).toBe('feature/agent-dev/revision-1');
      const failedRuntime = await store.executeRuntimeRun(created.id, 1, async () => ({ exitCode: 1, signal: null, timedOut: false, output: 'fixture failure', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));
      expect(failedRuntime).toMatchObject({ status: 'failed', attempts: 1, history: [{ attempt: 1, status: 'failed' }] });
      expect(store.getProject(created.id)?.state).toBe('IMPLEMENTING');
      await expect(readFile(join(completed.workspacePath, 'RUNTIME_RUN_REPORT.md'), 'utf8')).resolves.toContain('Attempt 1');
      const retriedRuntime = await store.retryRuntimeRun(created.id, 1, async () => ({ exitCode: 0, signal: null, timedOut: false, output: 'fixture success', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));
      expect(retriedRuntime).toMatchObject({ status: 'completed', attempts: 2, history: [{ status: 'failed' }, { attempt: 2, status: 'completed' }] });
      expect(store.getProject(created.id)?.state).toBe('VERIFYING');
      await expect(readFile(join(completed.workspacePath, 'RUNTIME_RUN_REPORT.md'), 'utf8')).resolves.toContain('Attempt 1');
      await expect(store.retryRuntimeRun(created.id, 1)).rejects.toThrow('Only a failed Runtime run can be retried.');
      const acceptance = await store.submitAcceptance(created.id, 1, 'The feature task is defined and ready for review.', true);
      expect(acceptance).toMatchObject({ status: 'blocked', qualityStatus: 'failed', criteriaConfirmed: true });
      await expect(store.approveAcceptance(created.id, 1, 'test-user')).rejects.toThrow('Acceptance is blocked');
      await expect(readFile(join(completed.workspacePath, 'ACCEPTANCE_REPORT.md'), 'utf8')).resolves.toContain('Quality Gate status is failed.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits the code the agent wrote so the pushed branch carries the feature', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const created = await store.createProject({
        name: 'Agent Commit',
        blueprint: createBlueprint('agent-commit', { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const applied = await store.executeApplyRun((await store.createApplyRun(created.id, 1)).id);
      await store.createFeatureTask({ projectId: created.id, blueprintRevision: 1, title: 'Add receipt list', objective: 'Show the user a list of saved receipts.', acceptanceCriteria: ['The list renders saved receipts.'] });
      await store.approveFeatureTask(created.id, 1, 'test-user');
      await store.prepareRuntimeRun(created.id, 1);

      await store.executeRuntimeRun(created.id, 1, async () => {
        await writeFile(join(applied.workspacePath, 'apps', 'web', 'src', 'ReceiptList.tsx'), 'export const ReceiptList = () => null;\n', 'utf8');
        return { exitCode: 0, signal: null, timedOut: false, output: 'wrote the feature', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      });

      // The pushed branch is built from committed history, so agent work left in the working tree
      // would never reach review even though acceptance already passed.
      const tracked = await execFileAsync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: applied.workspacePath });
      expect(tracked.stdout).toContain('apps/web/src/ReceiptList.tsx');
      const evidence = await store.getGitEvidence(created.id, 1);
      expect(evidence.status).toBe('');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails the run instead of committing a workspace secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const created = await store.createProject({
        name: 'Secret Guard',
        blueprint: createBlueprint('secret-guard', { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const applied = await store.executeApplyRun((await store.createApplyRun(created.id, 1)).id);
      await store.createFeatureTask({ projectId: created.id, blueprintRevision: 1, title: 'Add receipt list', objective: 'Show the user a list of saved receipts.', acceptanceCriteria: ['The list renders saved receipts.'] });
      await store.approveFeatureTask(created.id, 1, 'test-user');
      await store.prepareRuntimeRun(created.id, 1);

      // A workspace created before the scaffold shipped a .gitignore has no ignore rules at all.
      await rm(join(applied.workspacePath, '.gitignore'));
      await writeFile(join(applied.workspacePath, '.env'), 'VERCEL_TOKEN=real-secret\n', 'utf8');
      const run = await store.executeRuntimeRun(created.id, 1, async () => ({ exitCode: 0, signal: null, timedOut: false, output: 'wrote the feature', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }));

      expect(run.status).toBe('failed');
      expect(run.result?.output).toContain('.env');
      const tracked = await execFileAsync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: applied.workspacePath });
      expect(tracked.stdout).not.toContain('.env');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('recovers the same Apply Run after an injected step failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Recoverable Apply',
        blueprint: createBlueprint('recoverable-apply', {
          mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme',
        }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const queued = await store.createApplyRun(created.id, 1);
      const failed = await store.executeApplyRun(queued.id, { failStep: 'write-artifacts' });
      expect(failed.status).toBe('failed');
      expect(failed.attempts).toBe(1);
      expect(failed.steps.find(step => step.id === 'validate-blueprint')?.status).toBe('completed');
      expect(failed.steps.find(step => step.id === 'write-artifacts')?.status).toBe('failed');

      const recovered = await store.executeApplyRun(queued.id);
      expect(recovered.status).toBe('completed');
      expect(recovered.attempts).toBe(2);
      expect(store.getProject(created.id)?.state).toBe('BASELINE_READY');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('journals a release only after a human approves it, and survives a reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Releasable',
        blueprint: createBlueprint('releasable', {
          mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme',
        }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const applied = await store.executeApplyRun((await store.createApplyRun(created.id, 1)).id);
      await store.advanceDelivery(created.id, [
        { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
        { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' }, { type: 'PREVIEW_AVAILABLE' },
      ]);
      expect(store.getProject(created.id)?.state).toBe('PREVIEW_READY');

      // Approval is the gate: from PREVIEW_READY there is nothing to approve yet.
      await expect(store.approveRelease(created.id, 1, { approvedBy: 'test-user', summary: 'ship', steps: [] })).rejects.toThrow('AWAITING_APPROVAL');
      expect(store.getLatestReleaseRun(created.id, 1)).toBeNull();

      await store.requestRelease(created.id, 1);
      expect(store.getProject(created.id)?.state).toBe('AWAITING_APPROVAL');
      await expect(store.approveRelease(created.id, 1, { approvedBy: '  ', summary: 'ship', steps: [] })).rejects.toThrow('name who approved it');
      expect(store.getLatestReleaseRun(created.id, 1)).toBeNull();

      const release = await store.approveRelease(created.id, 1, {
        approvedBy: 'test-user',
        summary: 'Release revision 1 to production.',
        steps: [{ id: 'verify-release-quality', title: 'Verify release quality', status: 'pending' }],
      });
      expect(release).toMatchObject({ status: 'queued', attempts: 0, approvedBy: 'test-user' });
      expect(store.getProject(created.id)?.state).toBe('RELEASING');

      await store.updateReleaseRun(release.id, 'running', [{ id: 'verify-release-quality', title: 'Verify release quality', status: 'completed', startedAt: '2026-08-23T00:00:00.000Z', completedAt: '2026-08-23T00:00:01.000Z' }], 1);
      const evidence = await store.recordReleaseEvidence(created.id, 1, {
        projectName: 'releasable',
        apiBaseUrl: 'https://releasable-api.vercel.app',
        webUrl: 'https://releasable-web.pages.dev',
        corsOrigin: 'https://releasable-web.pages.dev',
        approvedBy: 'test-user',
        approvalSummary: 'Release revision 1 to production.',
        observations: { apiHealth: { httpStatus: 200 } },
      });
      expect(evidence.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(store.getProject(created.id)?.state).toBe('DELIVERED');
      await expect(readFile(join(applied.workspacePath, 'PRODUCTION_EVIDENCE.md'), 'utf8')).resolves.toContain('"httpStatus":200');
      await store.close();

      const reopened = await AgentDevStore.open(databasePath);
      const journalled = reopened.getLatestReleaseRun(created.id, 1);
      expect(journalled).toMatchObject({ id: release.id, attempts: 1, status: 'running' });
      expect(journalled?.steps[0]).toMatchObject({ id: 'verify-release-quality', completedAt: '2026-08-23T00:00:01.000Z' });
      await expect(reopened.getReleaseEvidence(created.id, 1)).resolves.toMatchObject({ webUrl: 'https://releasable-web.pages.dev' });
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('sends a failed release back to the step that failed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Failing Release',
        blueprint: createBlueprint('failing-release', {
          mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme',
        }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      await store.executeApplyRun((await store.createApplyRun(created.id, 1)).id);
      await store.advanceDelivery(created.id, [
        { type: 'START_IMPLEMENTATION' }, { type: 'IMPLEMENTATION_COMPLETE' },
        { type: 'VERIFY_COMPLETE' }, { type: 'PR_CREATED' }, { type: 'PREVIEW_AVAILABLE' },
      ]);
      await store.requestRelease(created.id, 1);
      const release = await store.approveRelease(created.id, 1, {
        approvedBy: 'test-user', summary: 'Release revision 1.',
        steps: [{ id: 'deploy-api-production', title: 'Deploy API', status: 'pending' }],
      });

      const failed = await store.failRelease(release.id, [{ id: 'deploy-api-production', title: 'Deploy API', status: 'failed', detail: 'fixture failure' }]);
      expect(failed.status).toBe('failed');
      expect(store.getProject(created.id)?.state).toBe('FAILED');
      // The retry has to come back to RELEASING, not to the old fixed VERIFYING target.
      const retried = await store.advanceDelivery(created.id, [{ type: 'RETRY' }]);
      expect(retried.state).toBe('RELEASING');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('pushes and opens the pull request itself once the delivery is accepted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
      const created = await store.createProject({
        name: 'Publish PR',
        blueprint: createBlueprint('publish-pr', { mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme' }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const run = await store.executeApplyRun((await store.createApplyRun(created.id, 1)).id);
      const publisher = async (request: { branch: string; base: string; title: string; body: string }) => {
        calls.push(request);
        return { url: 'https://github.com/acme/publish-pr/pull/1', head: 'pushedsha' };
      };
      const calls: { branch: string; base: string; title: string; body: string }[] = [];

      // Nothing is accepted yet, so there is no delivery a pull request could carry.
      await expect(store.publishPullRequest(created.id, 1, publisher)).rejects.toThrow('A Feature Task is required before opening a pull request.');

      await store.createFeatureTask({ projectId: created.id, blueprintRevision: 1, title: 'Add receipt list', objective: 'Show the user a list of saved receipts.', acceptanceCriteria: ['The list renders saved receipts.'] });
      await store.approveFeatureTask(created.id, 1, 'test-user');
      await expect(store.publishPullRequest(created.id, 1, publisher)).rejects.toThrow('Approve the delivery before opening a pull request.');
      await store.prepareRuntimeRun(created.id, 1);
      await store.executeRuntimeRun(created.id, 1, async () => {
        await writeFile(join(run.workspacePath, 'apps', 'web', 'src', 'ReceiptList.tsx'), 'export const ReceiptList = () => null;\n', 'utf8');
        return { exitCode: 0, signal: null, timedOut: false, output: 'fixture success', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      });
      await writeFile(join(run.workspacePath, 'package.json'), JSON.stringify({ name: 'publish-pr', private: true, scripts: { quality: 'node -e ""' } }, null, 2) + '\n', 'utf8');
      expect((await store.runQualityGate(created.id, 1)).status).toBe('passed');
      await store.submitAcceptance(created.id, 1, 'The receipt list renders and the quality gate passes.', true);
      const acceptance = await store.approveAcceptance(created.id, 1, 'test-user');
      expect(store.getProject(created.id)?.state).toBe('LOCAL_ACCEPTED');

      // The quality-gate edit above is still untracked, and a pull request must carry everything.
      await expect(store.publishPullRequest(created.id, 1, publisher)).rejects.toThrow('Commit or discard the workspace changes');
      await execFileAsync('git', ['add', '-A'], { cwd: run.workspacePath });
      await execFileAsync('git', ['-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '-qm', 'chore: quality command'], { cwd: run.workspacePath });

      const evidence = await store.publishPullRequest(created.id, 1, publisher);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ branch: 'feature/agent-dev/revision-1', base: 'dev', title: 'Add receipt list' });
      expect(calls[0].body).toContain(acceptance.gitEvidence.head);
      expect(evidence.url).toBe('https://github.com/acme/publish-pr/pull/1');
      expect(evidence.checks.join('\n')).toContain('Pushed commit: pushedsha');
      expect(store.getProject(created.id)?.state).toBe('PR_OPEN');

      // A branch rewritten so it no longer carries the accepted commit must not be published as the
      // accepted delivery, even when the acceptance record itself is still on it.
      const tip = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: run.workspacePath })).stdout.trim();
      await execFileAsync('git', ['reset', '--hard', `${acceptance.gitEvidence.head}~1`], { cwd: run.workspacePath });
      await execFileAsync('git', ['checkout', tip, '--', 'acceptance.json', 'ACCEPTANCE_REPORT.md'], { cwd: run.workspacePath });
      await execFileAsync('git', ['-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '-qm', 'chore: rewritten history'], { cwd: run.workspacePath });
      await expect(store.publishPullRequest(created.id, 1, publisher)).rejects.toThrow(`The accepted commit ${acceptance.gitEvidence.head} is not part of`);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('orders apply runs deterministically when several exist for one revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-storage-'));
    const databasePath = join(directory, 'agent-dev.sqlite');
    try {
      const store = await AgentDevStore.open(databasePath);
      const created = await store.createProject({
        name: 'Ordered Applies',
        blueprint: createBlueprint('ordered-applies', {
          mode: 'professional', githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme',
        }),
      });
      await store.approveBaseline(created.id, 1, 'test-user');
      const first = await store.createApplyRun(created.id, 1);
      expect(first.recoveryIndex).toBe(0);
      expect(store.listApplyRuns(created.id, 1)).toHaveLength(1);
      expect(store.getLatestApplyRun(created.id, 1)?.id).toBe(first.id);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
