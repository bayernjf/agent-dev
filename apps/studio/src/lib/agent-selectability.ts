import type { AgentCapabilityProbe, AgentDescriptor, AgentProfile } from '../types';

export type AdapterStatus = AgentCapabilityProbe['adapterStatus'];

// "Detected" answers one question: this CLI is on PATH. The daemon answers a different one when a run
// is prepared - an Agent may only be launched if its execution Adapter has been exercised
// (isAgentExecutable, i.e. adapterStatus === 'verified'). Claude Code, Aider and OpenClaw are
// installed on many machines and still refused at execution time, so the two facts must not be
// rendered as one promise.
//
// The status is optional on AgentDescriptor because it travels with the catalog response. A missing
// value is read as 'unsupported': withholding a choice is recoverable, promising a run that the
// daemon will reject is not.
export function adapterStatusOf(agent: AgentDescriptor | undefined): AdapterStatus {
  return agent?.adapterStatus ?? 'unsupported';
}

// One question, asked by every surface that presents an Agent: the capability probe row, the
// Blueprint runtime radios, the Profile rows and the Runtime prepare gate. Each of them used to derive
// its own answer from `detected` alone, which is how a candidate Adapter became a selectable runtime.
export function canRunTasks(agent: AgentDescriptor | undefined): boolean {
  return Boolean(agent?.detected) && adapterStatusOf(agent) === 'verified';
}

// A Profile inherits the guarantee of its base Agent and cannot add one of its own: the overrides it
// carries are prompt/model/tool narrowing, not an execution contract. A Profile whose base Agent has
// left the catalog is therefore not runnable either.
export function canProfileRunTasks(profile: AgentProfile, agents: AgentDescriptor[]): boolean {
  return canRunTasks(agents.find(agent => agent.id === profile.baseAgentId));
}

// `selectedAgentId` holds an Agent id or a Profile id depending on which list the user clicked last,
// so the check takes both lists rather than assuming.
export function canRunSelectedAgent(
  agentId: string | null | undefined,
  agents: AgentDescriptor[],
  profiles: AgentProfile[],
): boolean {
  if (!agentId) return false;
  const profile = profiles.find(candidate => candidate.id === agentId);
  if (profile) return canProfileRunTasks(profile, agents);
  return canRunTasks(agents.find(candidate => candidate.id === agentId));
}
