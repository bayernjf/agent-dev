import { assign, createActor, createMachine } from 'xstate';

export const deliveryStates = [
  'DRAFT',
  'NEEDS_INPUT',
  'PLAN_READY',
  'PROVISIONING',
  'BASELINE_READY',
  'IMPLEMENTING',
  'VERIFYING',
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
    PROVISIONING: { on: { BASELINE_CREATED: 'BASELINE_READY', PAUSE: 'PAUSED', FAIL: 'FAILED' } },
    BASELINE_READY: { on: { START_IMPLEMENTATION: 'IMPLEMENTING' } },
    IMPLEMENTING: { on: { IMPLEMENTATION_COMPLETE: 'VERIFYING', PAUSE: 'PAUSED', FAIL: 'FAILED' } },
    VERIFYING: { on: { VERIFY_COMPLETE: 'PR_OPEN', PAUSE: 'PAUSED', FAIL: 'FAILED' } },
    PR_OPEN: { on: { PREVIEW_AVAILABLE: 'PREVIEW_READY', FAIL: 'FAILED' } },
    PREVIEW_READY: { on: { APPROVE_RELEASE: 'AWAITING_APPROVAL' } },
    AWAITING_APPROVAL: { on: { APPROVE_RELEASE: 'RELEASING', PAUSE: 'PAUSED' } },
    RELEASING: { on: { RELEASE_COMPLETE: 'DELIVERED', FAIL: 'FAILED' } },
    DELIVERED: { type: 'final' },
    PAUSED: { on: { RESUME: [{ target: 'PROVISIONING' }] } },
    FAILED: {
      on: {
        RETRY: {
          target: 'VERIFYING',
          actions: assign({ retryCount: ({ context }) => context.retryCount + 1 }),
        },
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
