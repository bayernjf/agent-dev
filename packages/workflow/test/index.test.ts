import { describe, expect, it } from 'vitest';
import { createNeedsInputRun, restoreDeliveryActor } from '../src/index.js';

describe('delivery workflow', () => {
  it('starts a newly created project in NEEDS_INPUT', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    expect(actor.getSnapshot().value).toBe('NEEDS_INPUT');
    actor.stop();
  });

  it('requires explicit approvals before provisioning and releasing', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    actor.send({ type: 'PLAN_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('PLAN_READY');
    actor.send({ type: 'APPROVE_PROVISIONING' });
    expect(actor.getSnapshot().value).toBe('PROVISIONING');
    actor.stop();
  });

  it('restores a persisted gate and continues from the saved state', () => {
    const original = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    original.send({ type: 'PLAN_COMPLETE' });
    original.send({ type: 'APPROVE_PROVISIONING' });
    const snapshot = original.getPersistedSnapshot();
    original.stop();

    const restored = restoreDeliveryActor({ projectId: 'project-1', runId: 'run-1' }, snapshot);
    expect(restored.getSnapshot().value).toBe('PROVISIONING');
    restored.send({ type: 'BASELINE_CREATED' });
    expect(restored.getSnapshot().value).toBe('BASELINE_READY');
    restored.stop();
  });
});
