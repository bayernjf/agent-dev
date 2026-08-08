import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export type AgentSource = 'built-in' | 'custom';

export type AgentCapability = 'workspace-write' | 'read-only' | 'version-detection';

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
  codex: ['workspace-write', 'version-detection'],
  'claude-code': ['workspace-write', 'version-detection'],
  openclaw: ['workspace-write', 'version-detection'],
  'pi-agent': ['read-only', 'version-detection'],
  codebuddy: ['read-only', 'version-detection'],
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
