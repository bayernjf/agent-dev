import { describe, expect, it } from 'vitest';
import { FakeProviderAdapter } from '../src/index.js';

const resources = [
  { id: 'web-project', kind: 'pages-project', owner: 'acme' },
  { id: 'api-project', kind: 'functions-project', owner: 'acme' },
];

describe('FakeProviderAdapter', () => {
  it('keeps plan side-effect free and applies only with approval', async () => {
    const adapter = new FakeProviderAdapter('fake-cloud');
    const plan = await adapter.plan(resources);
    expect(plan.noExternalChanges).toBe(true);
    expect(plan.resources.map(resource => resource.action)).toEqual(['create', 'create']);
    await expect(adapter.discover()).resolves.toMatchObject({ resources: [] });
    await expect(adapter.apply(plan, { id: 'approval-1', status: 'approved', approvedAt: '2026-08-06T00:00:00.000Z' })).resolves.toMatchObject({ applied: true });
    await expect(adapter.verify(resources)).resolves.toMatchObject({ verified: true, missing: [], mismatched: [] });
  });

  it('detects drift and keeps repeated plans idempotent', async () => {
    const adapter = new FakeProviderAdapter('fake-cloud');
    const plan = await adapter.plan(resources);
    await adapter.apply(plan, { id: 'approval-1', status: 'approved', approvedAt: '2026-08-06T00:00:00.000Z' });
    const repeat = await adapter.plan(resources);
    expect(repeat.resources.every(resource => resource.action === 'noop')).toBe(true);
    const drift = await adapter.detectDrift([{ ...resources[0], owner: 'other-org' }]);
    expect(drift).toMatchObject([{ resourceId: 'web-project', type: 'owner-mismatch' }]);
  });

  it('rejects plans and approvals from the wrong boundary', async () => {
    const adapter = new FakeProviderAdapter('fake-cloud');
    const plan = await adapter.plan(resources);
    await expect(adapter.apply({ ...plan, providerId: 'other-cloud' }, { id: 'approval-1', status: 'approved', approvedAt: '2026-08-06T00:00:00.000Z' })).rejects.toThrow('does not match');
    await expect(adapter.apply(plan, { id: 'pending', status: 'approved', approvedAt: '2026-08-06T00:00:00.000Z' })).resolves.toMatchObject({ applied: true });
  });
});
