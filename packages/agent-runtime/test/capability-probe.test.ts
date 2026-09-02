import { describe, expect, afterAll, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildAgentExecutionPlan, getAgentAdapterStatus, probeAgentCapabilities } from '../src/index.js';
import { NON_INTERACTIVE_SWITCHES } from '../src/non-interactive-switches.js';

// The probe used to spawn whichever CLIs happened to be installed, so what it reported depended on
// the machine and no test could say what a given answer meant. Every case below injects the help
// text instead, which is the only thing the probe actually reasons over.
type HelpCall = { command: string; subcommand?: string };

function fakeHelp(levels: Record<string, string>) {
  const calls: HelpCall[] = [];
  const readHelp = (command: string, subcommand?: string) => {
    calls.push({ command, subcommand });
    return levels[subcommand ? `${command} ${subcommand}` : command] ?? '';
  };
  return { calls, readHelp };
}

const task = { id: 'probe-task', title: 'Add list', objective: 'Show saved items.', acceptanceCriteria: ['Items render.'] };

// Two CLIs whose only difference is that one of them fails. Written once and reused, because the
// probe caches help output per command for the life of the process.
let helpFixtureDirectory: string | null = null;

async function withHelpFixtures(run: () => Promise<void> | void) {
  if (!helpFixtureDirectory) {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-help-fixture-'));
    const sh = (lines: string, exit: string) => `#!/bin/sh\n${lines}${exit}`;
    const cmd = (lines: string, exit: string) => `@echo off\r\n${lines}${exit}`;
    const printed = 'echo   --message  prompt text\necho   --yes-always  never ask\n';
    await writeFile(join(directory, 'agent-dev-helps-ok'), sh(printed, ''), 'utf8');
    await writeFile(join(directory, 'agent-dev-helps-ok.cmd'), cmd(printed.replace(/\n/g, '\r\n'), ''), 'utf8');
    const toStderr = printed.replace(/\n/g, ' >&2\n');
    await writeFile(join(directory, 'agent-dev-helps-failing'), sh(toStderr, 'exit 1\n'), 'utf8');
    await writeFile(join(directory, 'agent-dev-helps-failing.cmd'), cmd(toStderr.replace(/\n/g, '\r\n'), 'exit /b 1\r\n'), 'utf8');
    await chmod(join(directory, 'agent-dev-helps-ok'), 0o755);
    await chmod(join(directory, 'agent-dev-helps-failing'), 0o755);
    helpFixtureDirectory = directory;
  }
  const originalPath = process.env.PATH;
  // Prepend rather than replace: on Windows the probe spawns through cmd.exe, which has to stay
  // reachable on PATH for either fixture to run at all.
  process.env.PATH = `${helpFixtureDirectory}${delimiter}${originalPath ?? ''}`;
  try {
    await run();
  } finally {
    process.env.PATH = originalPath;
  }
}

afterAll(async () => {
  if (helpFixtureDirectory) {
    await rm(helpFixtureDirectory, { recursive: true, force: true });
    helpFixtureDirectory = null;
  }
});

describe('capability probe', () => {
  it('reads the help level where the switch is documented', () => {
    // `codex --help` has no `--json`; `codex exec --help` does. Probing the top level reported a
    // verified-by-execution Adapter as lacking the switch, which is a bug about our question, not a
    // fact about the Agent.
    const { calls, readHelp } = fakeHelp({
      codex: 'Usage: codex [OPTIONS] [PROMPT]\n  --sandbox <MODE>\n',
      'codex exec': 'Usage: codex exec [OPTIONS] [PROMPT]\n      --json\n',
    });
    expect(probeAgentCapabilities('codex', 'codex', readHelp).nonInteractive).toBe(true);
    expect(calls).toEqual([{ command: 'codex', subcommand: 'exec' }]);
  });

  it('reports a switch it looked for and did not find as not found', () => {
    const { readHelp } = fakeHelp({ 'codex exec': 'Usage: codex exec [OPTIONS] [PROMPT]\n      --json-lines\n' });
    const probe = probeAgentCapabilities('codex', 'codex', readHelp);
    expect(probe).toMatchObject({ nonInteractive: false, helpAvailable: true });
  });

  // The pair (helpAvailable, nonInteractiveFlags) is what lets Studio tell "the help text contradicts
  // us" from "the help text never answered" from "there was nothing to look for". Collapsing those
  // into one boolean is what made a false render as an unknown and an unknown as a false.
  it('keeps a silent CLI distinguishable from an answering one', () => {
    const silent = fakeHelp({});
    expect(probeAgentCapabilities('hermes', 'hermes', silent.readHelp)).toMatchObject({
      nonInteractive: false,
      helpAvailable: false,
      nonInteractiveFlags: ['-z'],
    });
    const answered = fakeHelp({ hermes: 'Usage: hermes [OPTIONS] [PROMPT]\n  -z, --zero-shot\n' });
    expect(probeAgentCapabilities('hermes', 'hermes', answered.readHelp)).toMatchObject({
      nonInteractive: true,
      helpAvailable: true,
    });
  });

  it('does not read a longer switch as a shorter one', () => {
    // Both halves of this used to confirm: `--json-lines` contains `--json`, and `--permission-mode`
    // contains `-p`. Neither documents the switch the Adapter passes.
    const jsonLines = fakeHelp({ 'codex exec': 'Usage: codex exec [OPTIONS]\n      --json-lines <MODE>\n' });
    expect(probeAgentCapabilities('codex', 'codex', jsonLines.readHelp).nonInteractive).toBe(false);
    const permissionOnly = fakeHelp({ codebuddy: 'Options:\n  --permission-mode <mode>  Session mode\n' });
    expect(probeAgentCapabilities('codebuddy', 'codebuddy', permissionOnly.readHelp).nonInteractive).toBe(false);
  });

  it('accepts any documented spelling of a switch', () => {
    for (const spelling of ['-p', '--print']) {
      const { readHelp } = fakeHelp({ claude: `Options:\n  ${spelling}  print response and exit\n` });
      expect(probeAgentCapabilities('claude-code', 'claude', readHelp).nonInteractive).toBe(true);
    }
    const neither = fakeHelp({ claude: 'Options:\n  --help  show help\n' });
    expect(probeAgentCapabilities('claude-code', 'claude', neither.readHelp).nonInteractive).toBe(false);
  });

  it('does not treat a substring of the real switch as the switch', () => {
    // The table asked for `--yes`, so this help text used to confirm aider - while the Adapter passes
    // `--yes-always`, which is a different switch with different behaviour.
    const { readHelp } = fakeHelp({ aider: 'Options:\n  --message <text>\n  --yes  confirm each prompt\n' });
    const probe = probeAgentCapabilities('aider', 'aider', readHelp);
    expect(probe.nonInteractive).toBe(false);
    expect(probe.nonInteractiveFlags).toContain('--yes-always');
  });

  it('says nothing about an Agent whose non-interactive path is not a switch', () => {
    // OpenCode 2.0 runs through a driver script talking to a local service; its help text lists
    // subcommands, none of which is how a task is actually launched. Reporting that as "not
    // non-interactive" would be a lie in the other direction, so there is no expectation at all.
    const { readHelp } = fakeHelp({ opencode: 'Commands:\n  opencode run [message..]\n  opencode serve\n' });
    const probe = probeAgentCapabilities('opencode', 'opencode', readHelp);
    expect(NON_INTERACTIVE_SWITCHES.opencode.switches).toEqual([]);
    expect(probe).toMatchObject({ nonInteractive: false, nonInteractiveFlags: [], helpAvailable: true });
  });

  // The injected reader covers the reasoning; this covers what no fixture can imitate - the shell
  // answering for a CLI that never started. Both fixtures print the same two switches, so only where
  // the text came from and how the process ended can tell them apart. Two cases, because one shared
  // case lets a defect in either half hide the other behind the first failed assertion.
  it('accepts a help page from a command that ran', async () => {
    await withHelpFixtures(() => {
      const answered = probeAgentCapabilities('aider', 'agent-dev-helps-ok');
      expect(answered).toMatchObject({ nonInteractive: true, helpAvailable: true });
    });
  });

  it('does not accept a failing command as a help page', async () => {
    await withHelpFixtures(() => {
      const broken = probeAgentCapabilities('aider', 'agent-dev-helps-failing');
      expect(broken).toMatchObject({ nonInteractive: false, helpAvailable: false });
    });
  });
});

describe('non-interactive switch table', () => {
  const agentIds = Object.keys(NON_INTERACTIVE_SWITCHES);

  it('is not empty for the built-in Agents that have an Adapter', () => {
    expect(agentIds.length).toBeGreaterThan(5);
    expect(agentIds).toContain('codex');
  });

  // The probe and the Adapter live in different files and drifted: aider was checked for a flag the
  // command never passes, and openclaw was probed for a subcommand that does not exist. A switch
  // nobody passes can only produce a fake confirmation, so this is the invariant that keeps the
  // probe's "seen in help" answer meaningful.
  it('only looks for switches its own execution Adapter passes', () => {
    for (const agentId of agentIds) {
      const { subcommand, switches } = NON_INTERACTIVE_SWITCHES[agentId];
      if (switches.length === 0) continue;
      const plan = buildAgentExecutionPlan(task, '/tmp/probe-drift', agentId);
      for (const spellings of switches) {
        expect(plan.command.some(token => spellings.some(spelling => token === spelling)), `${agentId} probe expects ${spellings.join(' or ')}, which its Adapter never passes`).toBe(true);
      }
      // Asking the wrong level is the same class of drift: the switch may exist somewhere in the
      // command while the named subcommand does not.
      if (subcommand) expect(plan.command, `${agentId} probe asks for \`${subcommand}\` help`).toContain(subcommand);
    }
  });

  it('does not expect an answer from an Agent with no Adapter', () => {
    for (const agentId of agentIds) {
      if (getAgentAdapterStatus(agentId) === 'unsupported') {
        expect(NON_INTERACTIVE_SWITCHES[agentId].switches, `${agentId} has no Adapter to describe`).toEqual([]);
      }
    }
  });
});
