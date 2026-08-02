import { describe, expect, it } from 'vitest';
import { createNeedsInputRun } from '../src/index.js';

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
});
