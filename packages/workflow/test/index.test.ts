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

  it('records local acceptance before any PR, preview, or release transition', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    actor.send({ type: 'PLAN_COMPLETE' });
    actor.send({ type: 'APPROVE_PROVISIONING' });
    actor.send({ type: 'BASELINE_CREATED' });
    actor.send({ type: 'START_IMPLEMENTATION' });
    actor.send({ type: 'IMPLEMENTATION_COMPLETE' });
    actor.send({ type: 'VERIFY_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('LOCAL_ACCEPTED');
    actor.send({ type: 'PR_CREATED' });
    expect(actor.getSnapshot().value).toBe('PR_OPEN');
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

  it('retries the step that failed instead of a fixed state', () => {
    const advanceTo = (target: 'PROVISIONING' | 'IMPLEMENTING' | 'VERIFYING' | 'PR_OPEN' | 'RELEASING') => {
      const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
      actor.send({ type: 'PLAN_COMPLETE' });
      actor.send({ type: 'APPROVE_PROVISIONING' });
      if (target === 'PROVISIONING') return actor;
      actor.send({ type: 'BASELINE_CREATED' });
      actor.send({ type: 'START_IMPLEMENTATION' });
      if (target === 'IMPLEMENTING') return actor;
      actor.send({ type: 'IMPLEMENTATION_COMPLETE' });
      if (target === 'VERIFYING') return actor;
      actor.send({ type: 'VERIFY_COMPLETE' });
      actor.send({ type: 'PR_CREATED' });
      if (target === 'PR_OPEN') return actor;
      actor.send({ type: 'PREVIEW_AVAILABLE' });
      actor.send({ type: 'REQUEST_RELEASE' });
      actor.send({ type: 'APPROVE_RELEASE' });
      return actor;
    };

    for (const origin of ['PROVISIONING', 'IMPLEMENTING', 'VERIFYING', 'PR_OPEN', 'RELEASING'] as const) {
      const actor = advanceTo(origin);
      expect(actor.getSnapshot().value).toBe(origin);
      actor.send({ type: 'FAIL' });
      expect(actor.getSnapshot().value).toBe('FAILED');
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).toBe(origin);
      expect(actor.getSnapshot().context.retryCount).toBe(1);
      actor.stop();
    }
  });

  it('resumes a paused run at the step that was paused', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    actor.send({ type: 'PLAN_COMPLETE' });
    actor.send({ type: 'APPROVE_PROVISIONING' });
    actor.send({ type: 'BASELINE_CREATED' });
    actor.send({ type: 'START_IMPLEMENTATION' });
    actor.send({ type: 'PAUSE' });
    expect(actor.getSnapshot().value).toBe('PAUSED');
    actor.send({ type: 'RESUME' });
    expect(actor.getSnapshot().value).toBe('IMPLEMENTING');
    actor.stop();
  });

  it('keeps requesting a release separate from approving one', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    actor.send({ type: 'PLAN_COMPLETE' });
    actor.send({ type: 'APPROVE_PROVISIONING' });
    actor.send({ type: 'BASELINE_CREATED' });
    actor.send({ type: 'START_IMPLEMENTATION' });
    actor.send({ type: 'IMPLEMENTATION_COMPLETE' });
    actor.send({ type: 'VERIFY_COMPLETE' });
    actor.send({ type: 'PR_CREATED' });
    actor.send({ type: 'PREVIEW_AVAILABLE' });
    expect(actor.getSnapshot().value).toBe('PREVIEW_READY');

    // An approval alone must not move a preview into the approval gate.
    actor.send({ type: 'APPROVE_RELEASE' });
    expect(actor.getSnapshot().value).toBe('PREVIEW_READY');

    actor.send({ type: 'REQUEST_RELEASE' });
    expect(actor.getSnapshot().value).toBe('AWAITING_APPROVAL');
    actor.send({ type: 'APPROVE_RELEASE' });
    expect(actor.getSnapshot().value).toBe('RELEASING');
    actor.send({ type: 'RELEASE_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('DELIVERED');
    actor.stop();
  });

  it('opens the release gate straight from the PR for products without a hosted preview', () => {
    const actor = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    actor.send({ type: 'PLAN_COMPLETE' });
    actor.send({ type: 'APPROVE_PROVISIONING' });
    actor.send({ type: 'BASELINE_CREATED' });
    actor.send({ type: 'START_IMPLEMENTATION' });
    actor.send({ type: 'IMPLEMENTATION_COMPLETE' });
    actor.send({ type: 'VERIFY_COMPLETE' });
    actor.send({ type: 'PR_CREATED' });
    expect(actor.getSnapshot().value).toBe('PR_OPEN');

    // The shortcut still goes through the approval gate: a bare approval cannot open it.
    actor.send({ type: 'APPROVE_RELEASE' });
    expect(actor.getSnapshot().value).toBe('PR_OPEN');

    actor.send({ type: 'REQUEST_RELEASE' });
    expect(actor.getSnapshot().value).toBe('AWAITING_APPROVAL');
    actor.send({ type: 'APPROVE_RELEASE' });
    expect(actor.getSnapshot().value).toBe('RELEASING');
    actor.send({ type: 'RELEASE_COMPLETE' });
    expect(actor.getSnapshot().value).toBe('DELIVERED');
    actor.stop();
  });

  it('falls back to VERIFYING when a snapshot predates resumeTarget', () => {
    const original = createNeedsInputRun({ projectId: 'project-1', runId: 'run-1' });
    original.send({ type: 'PLAN_COMPLETE' });
    original.send({ type: 'APPROVE_PROVISIONING' });
    original.send({ type: 'FAIL' });
    const snapshot = original.getPersistedSnapshot() as unknown as { context: Record<string, unknown> };
    original.stop();

    // Snapshots already stored in existing databases were written before resumeTarget existed.
    delete snapshot.context.resumeTarget;

    const restored = restoreDeliveryActor({ projectId: 'project-1', runId: 'run-1' }, snapshot as never);
    expect(restored.getSnapshot().value).toBe('FAILED');
    restored.send({ type: 'RETRY' });
    expect(restored.getSnapshot().value).toBe('VERIFYING');
    restored.stop();
  });
});
