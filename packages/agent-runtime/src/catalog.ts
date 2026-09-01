import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export type AgentSource = 'built-in' | 'custom';

export type AgentCapability = 'workspace-write' | 'read-only' | 'version-detection' | 'non-interactive';

export type AgentDescriptor = {
  id: string;
  name: string;
  source: AgentSource;
  launchCommand: string;
  detected: boolean;
  version: string | null;
  detail: string;
  capabilities: AgentCapability[];
};

export type CustomAgentInput = {
  name: string;
  launchCommand: string;
};

function parseKeyValueCatalog(content: string): { name: string; launchCommand: string }[] {
  return content.split(/\r?\n/).flatMap(line => {
    const match = /^\s*"([^"]+)"\s*=\s*"([^"]+)"\s*$/.exec(line);
    return match ? [{ name: match[1], launchCommand: match[2] }] : [];
  });
}

function loadBuiltInAgents() {
  const content = readFileSync(new URL('../agents.builtin.conf', import.meta.url), 'utf8');
  return parseKeyValueCatalog(content).map((agent, index) => ({
    id: agent.launchCommand === 'claude' ? 'claude-code' : agent.launchCommand,
    ...agent,
    source: 'built-in' as const,
    order: index,
  }));
}

const BUILT_IN_CAPABILITIES: Record<string, AgentCapability[]> = {
  codex: ['workspace-write', 'version-detection', 'non-interactive'],
  'claude-code': ['workspace-write', 'version-detection', 'non-interactive'],
  aider: ['workspace-write', 'version-detection', 'non-interactive'],
  opencode: ['workspace-write', 'version-detection', 'non-interactive'],
  openclaw: ['workspace-write', 'version-detection', 'non-interactive'],
  codebuddy: ['workspace-write', 'version-detection', 'non-interactive'],
  hermes: ['workspace-write', 'version-detection', 'non-interactive'],
  pi: ['read-only', 'version-detection'],
};

const NON_INTERACTIVE_FLAGS: Record<string, string[]> = {
  codex: ['exec', '--json'],
  'claude-code': ['-p', '--print'],
  aider: ['--message', '--yes'],
  // OpenCode 2.0 dropped `-p --print`; non-interactive execution goes through the `api` subcommand.
  opencode: ['api'],
  openclaw: ['exec', '--json'],
  codebuddy: ['-p', '--print'],
  // Hermes one-shot mode: `-z PROMPT` prints only the final response to stdout.
  hermes: ['-z'],
};

type DetectionResult = { detected: boolean; version: string | null; detail: string };

// Discovery used to shell out to `which`, which is not a Windows command. On a stock Windows box
// every Agent therefore looked absent, and the only reason this repo ever saw a working lookup is
// that an unrelated MSYS `which` happened to be on PATH. Resolving through PATH and PATHEXT in
// process removes the external binary, the per-probe child process, and the timeout that produced
// the false negatives this file used to retry around.
export function resolveExecutablePath(command: string): string | null {
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return null;
  // An explicit path is already the answer; PATHEXT must not rewrite `./bin/tool`.
  if (executable.includes('/') || executable.includes('\\') || isAbsolute(executable)) {
    return existsSync(executable) ? executable : null;
  }
  const directories = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  // cmd.exe tries the PATHEXT entries in order and only then a name with no extension. Order
  // matters here: an npm install leaves both `claude` (a POSIX sh script) and `claude.cmd` beside
  // each other, and handing the extensionless one to a shell hangs instead of running.
  const extensions = process.platform === 'win32'
    ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean), '']
    : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, `${executable}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// On Windows these CLIs are npm `.cmd` shims, and Node refuses to spawn them without a shell since
// CVE-2024-27980 - the failure is an instant ENOENT, which is what made five of six locally
// installed Agents report "version probe failed". Both probes below pass a fixed literal argument,
// so the shell carries no user input and adds no injection surface (the same reasoning doctor.ts
// documents for npm/npx). Execution paths that pass a prompt are deliberately NOT given a shell.
const probeSpawnOptions = process.platform === 'win32' ? { shell: true } : {};

// Measured on Windows with a shell: codex 4.2s, opencode 3.2s, the rest under 0.6s. The previous
// 500 ms budget (2 s for codex) was below the real cost of every Node-based CLI on every platform.
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const HELP_PROBE_TIMEOUT_MS = 5_000;

function detect(command: string): DetectionResult {
  const cached = detectionCache.get(command);
  if (cached) return cached;
  if (!resolveExecutablePath(command)) {
    const result = { detected: false, version: null, detail: 'Command not found on local PATH.' };
    detectionCache.set(command, result);
    return result;
  }
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_PROBE_TIMEOUT_MS,
    ...probeSpawnOptions,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const detected = {
    // PATH presence is discovery; a failing version probe must not hide an installed Agent.
    detected: true,
    // Windows CLIs end their first line with CRLF; splitting on \n alone left a stray \r in the
    // version Studio displays.
    version: output ? output.split(/\r?\n/)[0] : null,
    detail: !result.error && result.status === 0
      ? 'Detected on local PATH.'
      : 'Command found on local PATH; version probe failed.',
  };
  detectionCache.set(command, detected);
  return detected;
}

const detectionCache = new Map<string, DetectionResult>();
const helpCache = new Map<string, string>();

function probeHelp(command: string): string {
  const cached = helpCache.get(command);
  if (cached !== undefined) return cached;
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(command, [flag], { encoding: 'utf8', timeout: HELP_PROBE_TIMEOUT_MS, ...probeSpawnOptions });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    if (output.length > 0) {
      helpCache.set(command, output);
      return output;
    }
  }
  helpCache.set(command, '');
  return '';
}

export type CapabilityProbe = {
  agentId: string;
  nonInteractive: boolean;
  nonInteractiveFlags: string[];
  workspaceWrite: boolean;
  helpAvailable: boolean;
};

export function probeAgentCapabilities(agentId: string, launchCommand: string): CapabilityProbe {
  const expectedFlags = NON_INTERACTIVE_FLAGS[agentId] ?? [];
  const helpOutput = probeHelp(launchCommand);
  const nonInteractive = expectedFlags.length > 0 && expectedFlags.every(flag => helpOutput.includes(flag));
  const workspaceWrite = (BUILT_IN_CAPABILITIES[agentId] ?? []).includes('workspace-write');
  return {
    agentId,
    nonInteractive,
    nonInteractiveFlags: expectedFlags,
    workspaceWrite,
    helpAvailable: helpOutput.length > 0,
  };
}

export function discoverAgentRuntimes(custom: CustomAgentInput[] = []): AgentDescriptor[] {
  const builtIns = loadBuiltInAgents().flatMap(agent => {
    const result = detect(agent.launchCommand);
    if (!result.detected) return [];
    return [{
      ...agent,
      ...result,
      capabilities: BUILT_IN_CAPABILITIES[agent.id] ?? ['version-detection'],
      detail: result.detail,
    }];
  });
  const customAgents = custom.map((agent, index) => {
    const result = detect(agent.launchCommand);
    return {
      id: `custom-${index + 1}`,
      ...agent,
      source: 'custom' as const,
      ...result,
      capabilities: ['version-detection'] as AgentCapability[],
      detail: result.detail,
    };
  });
  return [...builtIns, ...customAgents];
}
