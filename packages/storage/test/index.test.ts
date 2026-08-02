import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultBlueprint } from '@agent-dev/blueprint';
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
});
