import { describe, expect, it } from 'vitest';
import { FakeProviderRegistry, type ProviderResourceSpecs } from '../src/index.js';

const specs: ProviderResourceSpecs = {
  github: [{ id: 'repo', kind: 'repository', owner: 'acme' }],
  vercel: [{ id: 'api', kind: 'functions-project', owner: 'acme' }],
};

describe('FakeProviderRegistry', () => {
  it('plans, applies and verifies each provider independently', async () => {
    const registry = new FakeProviderRegistry();
    const plans = await registry.plan('project-1', specs);
    expect(plans).toHaveLength(2);
    expect(plans.every(plan => plan.noExternalChanges)).toBe(true);
    await registry.apply('project-1', plans, { id: 'approval-1', status: 'approved', approvedAt: '2026-08-06T00:00:00.000Z' });
    await expect(registry.verify('project-1', specs)).resolves.toEqual([
      { providerId: 'github', verified: true, missing: [], mismatched: [] },
      { providerId: 'vercel', verified: true, missing: [], mismatched: [] },
    ]);
  });
});
