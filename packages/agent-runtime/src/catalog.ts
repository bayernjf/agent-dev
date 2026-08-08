import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  codebuddy: ['read-only', 'version-detection'],
  pi: ['read-only', 'version-detection'],
  hermes: ['read-only', 'version-detection'],
};

const NON_INTERACTIVE_FLAGS: Record<string, string[]> = {
  codex: ['exec', '--json'],
  'claude-code': ['-p', '--print'],
  aider: ['--message', '--yes'],
  opencode: ['-p', '--print'],
  openclaw: ['exec', '--json'],
};

function detect(command: string) {
  const cached = detectionCache.get(command);
  if (cached) return cached;
  const executable = command.trim().split(/\s+/)[0];
  const lookup = spawnSync('which', [executable], { encoding: 'utf8', timeout: 300 });
  if (lookup.status !== 0 || lookup.error) {
    const result = { detected: false, version: null };
    detectionCache.set(command, result);
    return result;
  }
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: command === 'codex' ? 2_000 : 500 });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const detected = {
    detected: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
  };
  detectionCache.set(command, detected);
  return detected;
}

const detectionCache = new Map<string, { detected: boolean; version: string | null }>();
const helpCache = new Map<string, string>();

function probeHelp(command: string): string {
  const cached = helpCache.get(command);
  if (cached !== undefined) return cached;
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(command, [flag], { encoding: 'utf8', timeout: 2_000 });
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
      detail: result.detected ? 'Detected on local PATH.' : `Install ${agent.launchCommand} or add a custom launch command.`,
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
      detail: result.detected ? 'Custom command detected on local PATH.' : 'Command not detected. Check the launch command.',
    };
  });
  return [...builtIns, ...customAgents];
}
