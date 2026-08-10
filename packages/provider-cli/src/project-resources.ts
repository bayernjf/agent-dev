import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectResources = { version: 1; projectName: string; projectId: string; blueprintRevision: number; updatedAt: string; providers: Record<string, Record<string, unknown>> };

export function loadProjectResources(workspacePath: string): ProjectResources | null {
  try { return JSON.parse(readFileSync(join(workspacePath, '.agent-dev', 'project-resources.json'), 'utf8')) as ProjectResources; } catch { return null; }
}

export function writeProjectResources(workspacePath: string, projectName: string, projectId: string, blueprintRevision: number, providerId: string, state: Record<string, unknown>) {
  const directory = join(workspacePath, '.agent-dev');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const current = loadProjectResources(workspacePath) ?? { version: 1 as const, projectName, projectId, blueprintRevision, updatedAt: new Date().toISOString(), providers: {} };
  current.providers[providerId] = { ...state, updatedAt: new Date().toISOString() };
  current.updatedAt = new Date().toISOString();
  const path = join(directory, 'project-resources.json');
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
