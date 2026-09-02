// What a CLI's help output has to say before the capability probe may report that Agent as
// non-interactive.
//
// Every switch listed here is a switch `AGENT_ADAPTERS` in index.ts actually passes when it builds
// the command that runs a task. That rule is enforced by test/capability-probe.test.ts rather than
// by the type system, because the two tables live in different files and had already drifted: aider
// was checked for `--yes` while the Adapter passes `--yes-always` (a substring match made the wrong
// check pass), and openclaw was probed for an `exec` subcommand it does not have. A probe that
// looks for a flag nobody passes is worse than no probe, because it reports health.
//
// This is documentation evidence, not execution evidence. The claim "this Agent was run
// non-interactively and finished with exit 0" belongs to `status: 'verified'` in AGENT_ADAPTERS.

export type NonInteractiveSwitches = {
  // Which help level documents the switches. `codex` does not print `--json` in its top-level help,
  // but `codex exec --help` does, so reading the wrong level is a structural false negative: it
  // reports an Agent as lacking a capability its own Adapter depends on.
  subcommand?: string;
  // One entry per switch, with the spellings that mean the same switch grouped together. Claude
  // Code documents `-p` and `--print` as one switch, so requiring both would be asking for a
  // synonym, and requiring neither would be asking for nothing.
  switches: string[][];
};

export const NON_INTERACTIVE_SWITCHES: Record<string, NonInteractiveSwitches> = {
  // ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--cd', cwd, prompt]
  codex: { subcommand: 'exec', switches: [['--json']] },
  // ['claude', '-p', prompt, '--allowedTools', ..., '--output-format', 'json']
  'claude-code': { switches: [['-p', '--print']] },
  // ['aider', '--message', prompt, '--yes-always']
  aider: { switches: [['--message'], ['--yes-always']] },
  // OpenCode 2.0 dropped `-p --print`; tasks run through scripts/opencode2-driver.mjs driving
  // `opencode api POST /api/session`. Checked on a machine with OpenCode installed, its `--help` does
  // not even contain the word `api` - and were a later version to list the subcommand, a subcommand
  // name still would not show that a run needs no human answer. So there is no expectation here, and
  // the probe reports "cannot tell" rather than inventing one either way.
  opencode: { switches: [] },
  // ['openclaw', 'agent', '--local', '--agent', 'main', '--message', prompt, '--json']
  openclaw: { subcommand: 'agent', switches: [['--message'], ['--json']] },
  // ['codebuddy', '-p', '--permission-mode', 'bypassPermissions', '--no-session-persistence', prompt]
  codebuddy: { switches: [['-p', '--print'], ['--permission-mode']] },
  // ['hermes', '-z', prompt, '--in', cwd, '--yolo']
  hermes: { switches: [['-z']] },
};
