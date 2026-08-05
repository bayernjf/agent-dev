import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBlueprint, createDefaultBlueprint } from '@agent-dev/blueprint';
import { AgentDevStore } from '../src/index.js';

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
      expect(completed.steps.every(step => step.status === 'completed')).toBe(true);
      await expect(readFile(join(completed.workspacePath, 'apply-manifest.json'), 'utf8')).resolves.toContain('No provider resource was created');
      await expect(readFile(join(completed.workspacePath, 'DELIVERY_REPORT.md'), 'utf8')).resolves.toContain('External writes: none');
      await expect(readFile(join(completed.workspacePath, 'generated', 'AGENTS.md'), 'utf8')).resolves.toContain('Agent Execution Constraints');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
