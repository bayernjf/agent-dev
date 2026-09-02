import type { KeyPath } from '../i18n/i18n';

export type AgentCopyKeys = { desc: KeyPath; install?: KeyPath };

// These keys used to be built by mangling the Agent id (`claude-code` -> `agentClaudecodeDesc`).
// That failed twice over: the locale files name the Claude Code copy `agentClaude*`, so the lookup
// missed and `t()` returned the key itself, which rendered on screen as the literal text
// "blueprint.agentClaudecodeDesc"; and an id with a second hyphen would have leaked again even if
// the first had matched. OpenClaw had no copy at all and showed the same raw key.
//
// A table keyed by id cannot silently drift, and an id missing from it renders no description
// instead of leaking a key. `t()` returning the key on a miss is what turned a missing translation
// into visible garbage, so the fallback lives here rather than in the caller.
const AGENT_COPY: Record<string, AgentCopyKeys> = {
  codex: { desc: 'blueprint.agentCodexDesc', install: 'blueprint.agentCodexInstall' },
  // Key names do not follow the id; see the comment above.
  'claude-code': { desc: 'blueprint.agentClaudeDesc', install: 'blueprint.agentClaudeInstall' },
  aider: { desc: 'blueprint.agentAiderDesc', install: 'blueprint.agentAiderInstall' },
  opencode: { desc: 'blueprint.agentOpencodeDesc', install: 'blueprint.agentOpencodeInstall' },
  codebuddy: { desc: 'blueprint.agentCodebuddyDesc', install: 'blueprint.agentCodebuddyInstall' },
  hermes: { desc: 'blueprint.agentHermesDesc', install: 'blueprint.agentHermesInstall' },
  pi: { desc: 'blueprint.agentPiDesc', install: 'blueprint.agentPiInstall' },
  // No published install command for OpenClaw in this repository, so only the description exists.
  openclaw: { desc: 'blueprint.agentOpenclawDesc' },
};

export function agentCopyKeys(agentId: string): AgentCopyKeys | undefined {
  // Custom Agents register under their launch command, which is user input; prototype keys such as
  // "constructor" must not resolve to an inherited property.
  return Object.hasOwn(AGENT_COPY, agentId) ? AGENT_COPY[agentId] : undefined;
}
