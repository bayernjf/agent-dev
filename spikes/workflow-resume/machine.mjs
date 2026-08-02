import { assign, createMachine } from 'xstate';

export const deliveryMachine = createMachine({
  id: 'delivery',
  initial: 'implementing',
  context: {
    retryCount: 0,
  },
  states: {
    implementing: {
      on: {
        IMPLEMENTATION_FINISHED: 'verifying',
      },
    },
    verifying: {
      on: {
        PREVIEW_READY: 'awaitingApproval',
        VERIFICATION_FAILED: 'failed',
      },
    },
    awaitingApproval: {
      on: {
        APPROVE: 'releasing',
      },
    },
    releasing: {
      on: {
        RELEASE_SUCCEEDED: 'delivered',
        RELEASE_FAILED: 'failed',
      },
    },
    failed: {
      on: {
        RETRY: {
          target: 'verifying',
          actions: assign({
            retryCount: ({ context }) => context.retryCount + 1,
          }),
        },
      },
    },
    delivered: {
      type: 'final',
    },
  },
});
