import { describe, expect, it } from 'vitest';
import { buildCodexExecutionPlan, probeCodexRuntime } from '../src/index.js';

describe('Local Codex Runtime', () => {
  it('builds a non-executing sandboxed plan for an approved task', () => {
    const plan = buildCodexExecutionPlan({ id: 'task-1', title: 'Add list', objective: 'Show saved items.', acceptanceCriteria: ['Items render.'] }, '/tmp/agent-task');
    expect(plan).toMatchObject({ mode: 'dry-run', executionAllowed: false, noExternalChanges: true, workspacePath: '/tmp/agent-task' });
    expect(plan.command).toEqual(expect.arrayContaining(['exec', '--json', '--sandbox', 'workspace-write', '--cd', '/tmp/agent-task']));
    expect(plan.command.at(-1)).toContain('Items render.');
  });

  it('reports CLI presence without claiming authenticated execution', () => {
    expect(probeCodexRuntime()).toMatchObject({ command: 'codex', executionVerified: false });
  });
});
