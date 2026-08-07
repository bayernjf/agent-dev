import { spawnSync } from 'node:child_process';

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

const BUILT_IN_AGENTS: Omit<AgentDescriptor, 'detected' | 'version' | 'detail' | 'capabilities'>[] = [
  { id: 'codex', name: 'Codex', source: 'built-in', launchCommand: 'codex' },
  { id: 'claude-code', name: 'Claude Code', source: 'built-in', launchCommand: 'claude' },
  { id: 'openclaw', name: 'OpenClaw', source: 'built-in', launchCommand: 'openclaw' },
  { id: 'pi-agent', name: 'Pi Agent', source: 'built-in', launchCommand: 'pi' },
  { id: 'codebuddy', name: 'CodeBuddy', source: 'built-in', launchCommand: 'codebuddy' },
];

const BUILT_IN_CAPABILITIES: Record<string, AgentCapability[]> = {
  codex: ['workspace-write', 'version-detection'],
  'claude-code': ['workspace-write', 'version-detection'],
  openclaw: ['workspace-write', 'version-detection'],
  'pi-agent': ['read-only', 'version-detection'],
  codebuddy: ['read-only', 'version-detection'],
};

function detect(command: string) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 3_000 });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return {
    detected: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
  };
}

export function discoverAgentRuntimes(custom: CustomAgentInput[] = []): AgentDescriptor[] {
  const builtIns = BUILT_IN_AGENTS.map(agent => {
    const result = detect(agent.launchCommand);
    return {
      ...agent,
      ...result,
      capabilities: BUILT_IN_CAPABILITIES[agent.id] ?? ['version-detection'],
      detail: result.detected ? 'Detected on local PATH.' : `Install ${agent.launchCommand} or add a custom launch command.`,
    };
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
