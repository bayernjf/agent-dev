import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { CustomAgentInput } from '@agent-dev/agent-runtime';

const HEADER = '# Agent-Dev custom Agent catalog. Managed by the daemon — edit with care.\n';

export function loadCustomAgents(directory: string): CustomAgentInput[] {
  const filePath = join(directory, 'agents.yaml');
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseAgentsYaml(content);
  } catch {
    return [];
  }
}

export function saveCustomAgents(directory: string, agents: CustomAgentInput[]): void {
  const filePath = join(directory, 'agents.yaml');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeAgentsYaml(agents), 'utf8');
}

function serializeAgentsYaml(agents: CustomAgentInput[]): string {
  if (agents.length === 0) return `${HEADER}agents: []\n`;
  const body = agents.map(agent => `  - name: ${yamlValue(agent.name)}\n    launchCommand: ${yamlValue(agent.launchCommand)}`).join('\n');
  return `${HEADER}agents:\n${body}\n`;
}

function parseAgentsYaml(content: string): CustomAgentInput[] {
  const lines = content.split('\n');
  const agents: CustomAgentInput[] = [];
  let current: Partial<CustomAgentInput> | null = null;
  for (const line of lines) {
    const nameMatch = /^  -\s+name:\s+(.+)$/.exec(line);
    const commandMatch = /^    launchCommand:\s+(.+)$/.exec(line);
    if (nameMatch) {
      if (current?.name && current?.launchCommand) agents.push(current as CustomAgentInput);
      current = { name: unyamlValue(nameMatch[1]) };
    } else if (commandMatch && current) {
      current.launchCommand = unyamlValue(commandMatch[1]);
    }
  }
  if (current?.name && current?.launchCommand) agents.push(current as CustomAgentInput);
  return agents;
}

function yamlValue(value: string): string {
  return /[\n:#[\]{}&*!|>'"%@`]/.test(value) ? JSON.stringify(value) : value;
}

function unyamlValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }
  return trimmed;
}
