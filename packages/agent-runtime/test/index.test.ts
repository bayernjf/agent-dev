import { describe, expect, it } from 'vitest';
import { buildAgentExecutionPlan, buildCodexExecutionPlan, executeCodexPlan, getAgentAdapterStatus, isAgentExecutable, probeCodexRuntime, runCodexProcess } from '../src/index.js';

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

  it('requires an explicit execute plan before starting a process', async () => {
    const task = { id: 'task-2', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] };
    const dryRun = buildCodexExecutionPlan(task, '/tmp/agent-task');
    await expect(executeCodexPlan(dryRun, async () => {
      throw new Error('runner should not be called');
    })).rejects.toThrow('explicitly approved execute plan');
  });

  it('runs an explicitly approved plan through the injected process runner', async () => {
    const plan = buildCodexExecutionPlan({ id: 'task-3', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] }, '/tmp/agent-task', { execute: true });
    const result = await executeCodexPlan(plan, async (command, arguments_, options) => {
      expect(command).toBe('codex');
      expect(arguments_).toContain('--sandbox');
      expect(options.cwd).toBe('/tmp/agent-task');
      expect(options.env.HOME).toBeDefined();
      return { exitCode: 0, signal: null, timedOut: false, output: '{"type":"turn.completed"}', startedAt: '2026-08-07T00:00:00.000Z', completedAt: '2026-08-07T00:00:01.000Z' };
    });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  });

  it('allows candidate adapters to prepare a dry-run but blocks execution', () => {
    const task = { id: 'task-4', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] };
    const plan = buildAgentExecutionPlan(task, '/tmp/agent-task', 'claude-code');
    expect(plan).toMatchObject({ mode: 'dry-run', executionAllowed: false });
    expect(isAgentExecutable('claude-code')).toBe(false);
    expect(getAgentAdapterStatus('claude-code')).toBe('candidate');
    expect(getAgentAdapterStatus('custom-1')).toBe('unsupported');
    expect(() => buildAgentExecutionPlan(task, '/tmp/agent-task', 'claude-code', { execute: true })).toThrow('has not passed execution verification');
  });

  it('force-kills a process that keeps running through SIGTERM', async () => {
    const plan = buildCodexExecutionPlan({ id: 'task-5', title: 'Ignore signals', objective: 'Keep working.', acceptanceCriteria: ['Never finishes.'] }, process.cwd(), { execute: true });
    const ignoresSigterm = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    const result = await executeCodexPlan({ ...plan, command: ['node', '-e', ignoresSigterm] }, runCodexProcess, 500);
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGKILL');
  }, 20_000);

  it('gives a real feature task more than three minutes by default', async () => {
    const plan = buildCodexExecutionPlan({ id: 'task-6', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] }, '/tmp/agent-task', { execute: true });
    let observed = 0;
    await executeCodexPlan(plan, async (_command, _arguments, options) => {
      observed = options.timeoutMs;
      return { exitCode: 0, signal: null, timedOut: false, output: '', startedAt: '2026-08-23T00:00:00.000Z', completedAt: '2026-08-23T00:00:01.000Z' };
    });
    expect(observed).toBeGreaterThan(180_000);
  });
});
