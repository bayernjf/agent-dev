// The daemon refuses to quietly swap the executor of a Runtime run for another Agent. That refusal
// arrives as a 409 carrying this code, because GET .../runtime/plan already answers 409 for
// "nothing approved yet": one status, two different facts. Reading only the status collapsed them
// into the same empty panel, which hid the refusal entirely.
//
// Mirrors AGENT_NOT_EXECUTABLE_CODE in @agent-dev/agent-runtime, which the browser cannot import
// (that module pulls in node:child_process). Both copies are pinned to the same literal by tests:
// apps/daemon/test against a real response, this package's test against the constant below.
export const AGENT_NOT_EXECUTABLE_CODE = 'agent_not_executable';

/**
 * Blueprint runtime providers carry a `local-` namespace to say the runtime lives on this machine
 * (`local-opencode`), while the catalog, the Adapter registry and every run record written since use
 * the bare key. Run records prepared before that normalisation still carry the prefixed form, so a
 * name shown to a user has to shed it first - otherwise the panel prints a provider id where a
 * product name belongs.
 *
 * Mirrors runtimeProviderAgentId() in @agent-dev/agent-runtime for the same browser-import reason as
 * the constant above.
 */
export function withoutProviderNamespace(id: string): string {
  return id.startsWith('local-') ? id.slice('local-'.length) : id;
}

export type RuntimeExecutorFailure =
  | { kind: 'agent-not-executable'; agentId: string }
  | { kind: 'other' };

/** Whatever a Runtime route answered with; only the two fields below are consulted. */
export type RuntimeRejectionBody = { code?: unknown; agentId?: unknown; [field: string]: unknown };

/**
 * Narrow the payload of a failed Runtime request to the one refusal the panel has to explain itself.
 * Anything else - a 409 with no body, a 409 that lost its code, a 404 - stays on the generic path,
 * where the backend sentence is shown rather than a localisation guessed over it.
 */
export function classifyRuntimeExecutorFailure(
  status: number,
  payload: RuntimeRejectionBody,
): RuntimeExecutorFailure {
  if (status === 409 && payload.code === AGENT_NOT_EXECUTABLE_CODE && typeof payload.agentId === 'string') {
    return { kind: 'agent-not-executable', agentId: payload.agentId };
  }
  return { kind: 'other' };
}
