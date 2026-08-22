import { assign, createActor, createMachine } from 'xstate';

export const deliveryStates = [
  'DRAFT',
  'NEEDS_INPUT',
  'PLAN_READY',
  'PROVISIONING',
  'BASELINE_READY',
  'IMPLEMENTING',
  'VERIFYING',
  'LOCAL_ACCEPTED',
  'PR_OPEN',
  'PREVIEW_READY',
  'AWAITING_APPROVAL',
  'RELEASING',
  'DELIVERED',
  'PAUSED',
  'FAILED',
] as const;

export type DeliveryState = (typeof deliveryStates)[number];

export type DeliveryContext = {
  projectId: string;
  runId: string;
  retryCount: number;
  resumeTarget?: DeliveryState;
};

export type DeliveryEvent =
  | { type: 'REQUEST_INPUT' }
  | { type: 'PLAN_COMPLETE' }
  | { type: 'APPROVE_PROVISIONING' }
  | { type: 'BASELINE_CREATED' }
  | { type: 'START_IMPLEMENTATION' }
  | { type: 'IMPLEMENTATION_COMPLETE' }
  | { type: 'VERIFY_COMPLETE' }
  | { type: 'PR_CREATED' }
  | { type: 'PREVIEW_AVAILABLE' }
  | { type: 'APPROVE_RELEASE' }
  | { type: 'RELEASE_COMPLETE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'FAIL' }
  | { type: 'RETRY' };

// A run has to come back to the step that was interrupted. Recording the origin on the way
// into FAILED or PAUSED is what lets RETRY and RESUME target it instead of a fixed guess.
// Snapshots persisted before resumeTarget existed carry no origin, so both keep a fallback.
export const deliveryMachine = createMachine({
  types: {} as {
    context: DeliveryContext;
    events: DeliveryEvent;
    input: Pick<DeliveryContext, 'projectId' | 'runId'>;
  },
  id: 'delivery-run',
  initial: 'DRAFT',
  context: ({ input }) => ({ ...input, retryCount: 0 }),
  states: {
    DRAFT: { on: { REQUEST_INPUT: 'NEEDS_INPUT' } },
    NEEDS_INPUT: { on: { PLAN_COMPLETE: 'PLAN_READY' } },
    PLAN_READY: { on: { APPROVE_PROVISIONING: 'PROVISIONING' } },
    PROVISIONING: {
      on: {
        BASELINE_CREATED: 'BASELINE_READY',
        PAUSE: { target: 'PAUSED', actions: assign({ resumeTarget: () => 'PROVISIONING' as const }) },
        FAIL: { target: 'FAILED', actions: assign({ resumeTarget: () => 'PROVISIONING' as const }) },
      },
    },
    BASELINE_READY: { on: { START_IMPLEMENTATION: 'IMPLEMENTING' } },
    IMPLEMENTING: {
      on: {
        IMPLEMENTATION_COMPLETE: 'VERIFYING',
        PAUSE: { target: 'PAUSED', actions: assign({ resumeTarget: () => 'IMPLEMENTING' as const }) },
        FAIL: { target: 'FAILED', actions: assign({ resumeTarget: () => 'IMPLEMENTING' as const }) },
      },
    },
    VERIFYING: {
      on: {
        VERIFY_COMPLETE: 'LOCAL_ACCEPTED',
        PAUSE: { target: 'PAUSED', actions: assign({ resumeTarget: () => 'VERIFYING' as const }) },
        FAIL: { target: 'FAILED', actions: assign({ resumeTarget: () => 'VERIFYING' as const }) },
      },
    },
    LOCAL_ACCEPTED: {
      on: {
        PR_CREATED: 'PR_OPEN',
        PAUSE: { target: 'PAUSED', actions: assign({ resumeTarget: () => 'LOCAL_ACCEPTED' as const }) },
      },
    },
    PR_OPEN: {
      on: {
        PREVIEW_AVAILABLE: 'PREVIEW_READY',
        FAIL: { target: 'FAILED', actions: assign({ resumeTarget: () => 'PR_OPEN' as const }) },
      },
    },
    PREVIEW_READY: { on: { APPROVE_RELEASE: 'AWAITING_APPROVAL' } },
    AWAITING_APPROVAL: {
      on: {
        APPROVE_RELEASE: 'RELEASING',
        PAUSE: { target: 'PAUSED', actions: assign({ resumeTarget: () => 'AWAITING_APPROVAL' as const }) },
      },
    },
    RELEASING: {
      on: {
        RELEASE_COMPLETE: 'DELIVERED',
        FAIL: { target: 'FAILED', actions: assign({ resumeTarget: () => 'RELEASING' as const }) },
      },
    },
    DELIVERED: { type: 'final' },
    PAUSED: {
      on: {
        RESUME: [
          { target: 'IMPLEMENTING', guard: ({ context }) => context.resumeTarget === 'IMPLEMENTING' },
          { target: 'VERIFYING', guard: ({ context }) => context.resumeTarget === 'VERIFYING' },
          { target: 'LOCAL_ACCEPTED', guard: ({ context }) => context.resumeTarget === 'LOCAL_ACCEPTED' },
          { target: 'AWAITING_APPROVAL', guard: ({ context }) => context.resumeTarget === 'AWAITING_APPROVAL' },
          { target: 'PROVISIONING' },
        ],
      },
    },
    FAILED: {
      on: {
        RETRY: [
          { target: 'PROVISIONING', guard: ({ context }) => context.resumeTarget === 'PROVISIONING', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
          { target: 'IMPLEMENTING', guard: ({ context }) => context.resumeTarget === 'IMPLEMENTING', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
          { target: 'PR_OPEN', guard: ({ context }) => context.resumeTarget === 'PR_OPEN', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
          { target: 'RELEASING', guard: ({ context }) => context.resumeTarget === 'RELEASING', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
          { target: 'VERIFYING', actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }) },
        ],
      },
    },
  },
});

export function createDeliveryActor(input: Pick<DeliveryContext, 'projectId' | 'runId'>) {
  return createActor(deliveryMachine, { input }).start();
}

export type DeliverySnapshot = ReturnType<ReturnType<typeof createDeliveryActor>['getPersistedSnapshot']>;

export function restoreDeliveryActor(input: Pick<DeliveryContext, 'projectId' | 'runId'>, snapshot: DeliverySnapshot) {
  return createActor(deliveryMachine, { input, snapshot }).start();
}

export function createNeedsInputRun(input: Pick<DeliveryContext, 'projectId' | 'runId'>) {
  const actor = createDeliveryActor(input);
  actor.send({ type: 'REQUEST_INPUT' });
  return actor;
}
