import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { CustomAgentInput } from '@agent-dev/agent-runtime';

const HEADER = '# Agent-Dev custom Agent catalog. Managed by the daemon — edit with care.\n';

export function loadCustomAgents(directory: string): CustomAgentInput[] {
  const filePath = join(directory, 'agents.conf');
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    return parseAgentsConf(content);
  } catch {
    return [];
  }
}

export function saveCustomAgents(directory: string, agents: CustomAgentInput[]): void {
  const filePath = join(directory, 'agents.conf');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeAgentsYaml(agents), 'utf8');
}

function serializeAgentsYaml(agents: CustomAgentInput[]): string {
  if (agents.length === 0) return `${HEADER}`;
  return `${HEADER}${agents.map(agent => `${quote(agent.name)} = ${quote(agent.launchCommand)}`).join('\n')}\n`;
}

function parseAgentsConf(content: string): CustomAgentInput[] {
  return content.split(/\r?\n/).flatMap(line => {
    const match = /^\s*"([^"]+)"\s*=\s*"([^"]+)"\s*$/.exec(line);
    return match ? [{ name: match[1], launchCommand: match[2] }] : [];
  });
}

function quote(value: string): string {
  return JSON.stringify(value);
}
