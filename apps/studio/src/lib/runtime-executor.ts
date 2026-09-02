// The daemon refuses to quietly swap the executor of a Runtime run for another Agent. That refusal
// arrives as a 409 carrying this code, because GET .../runtime/plan already answers 409 for
// "nothing approved yet": one status, two different facts. Reading only the status collapsed them
// into the same empty panel, which hid the refusal entirely.
//
// Mirrors AGENT_NOT_EXECUTABLE_CODE in @agent-dev/agent-runtime, which the browser cannot import
// (that module pulls in node:child_process). Both copies are pinned to the same literal by tests:
// apps/daemon/test against a real response, this package's test against the constant below.
export const AGENT_NOT_EXECUTABLE_CODE = 'agent_not_executable';

// Mirrors AGENT_NOT_DETECTED_CODE in @agent-dev/agent-runtime. The second code exists because the two
// refusals are not the same fact: one is about an execution contract the registry has never verified,
// which is true on every machine, and the other is about a CLI that is not installed here, which is
// true until someone installs it. They cannot share a sentence in the interface.
export const AGENT_NOT_DETECTED_CODE = 'agent_not_detected';

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
  | { kind: 'agent-not-detected'; agentId: string }
  | { kind: 'other' };

/** Whatever a Runtime route answered with; only the two fields below are consulted. */
export type RuntimeRejectionBody = { code?: unknown; agentId?: unknown; [field: string]: unknown };

/**
 * Narrow the payload of a failed Runtime request to the refusals the panel has to explain itself.
 * Anything else - a 409 with no body, a 409 that lost its code, a 404 - stays on the generic path,
 * where the backend sentence is shown rather than a localisation guessed over it.
 */
export function classifyRuntimeExecutorFailure(
  status: number,
  payload: RuntimeRejectionBody,
): RuntimeExecutorFailure {
  if (status !== 409 || typeof payload.agentId !== 'string') return { kind: 'other' };
  if (payload.code === AGENT_NOT_EXECUTABLE_CODE) return { kind: 'agent-not-executable', agentId: payload.agentId };
  if (payload.code === AGENT_NOT_DETECTED_CODE) return { kind: 'agent-not-detected', agentId: payload.agentId };
  return { kind: 'other' };
}

/** The three things the Runtime panel can know about who runs the task, weakest last. */
export type ExecutorNaming = {
  runAgentId?: string | null;
  selectedAgentId?: string | null;
  blueprintProvider?: string | null;
};

/**
 * Whose name the Runtime panel is allowed to print as the executor.
 *
 * A run record is the fact of who was planned; an explicit selection is the user's own choice; and
 * with neither, the Blueprint revision a human approved says who takes the task. What must not happen
 * is naming an Agent because it happens to be installed: the panel used to fall back to the first
 * runnable catalog entry, so a project approved with Claude Code in it read "Codex" and Prepare sent
 * a Codex run, with nothing on screen admitting the swap.
 *
 * The Blueprint provider is returned stripped because it is stored namespaced; a legacy run record may
 * still carry the prefix, and the caller resolves names by trying the id as written first.
 */
export function runtimeExecutorId(sources: ExecutorNaming): string | null {
  if (sources.runAgentId) return sources.runAgentId;
  if (sources.selectedAgentId) return sources.selectedAgentId;
  return sources.blueprintProvider ? withoutProviderNamespace(sources.blueprintProvider) : null;
}
