import { describe, expect, it } from 'vitest';
import { buildAgentExecutionPlan, describeRuntimeExecutorRejection, executeCodexPlan, getAgentAdapterStatus, isAgentExecutable, probeCodexRuntime, resolveRuntimeExecutor, runCodexProcess, runtimeProviderAgentId } from '../src/index.js';
import type { AgentProfile } from '../src/profiles.js';

describe('Local Codex Runtime', () => {
  it('builds a non-executing sandboxed plan for an approved task', () => {
    const plan = buildAgentExecutionPlan({ id: 'task-1', title: 'Add list', objective: 'Show saved items.', acceptanceCriteria: ['Items render.'] }, '/tmp/agent-task', 'codex');
    expect(plan).toMatchObject({ mode: 'dry-run', executionAllowed: false, noExternalChanges: true, workspacePath: '/tmp/agent-task' });
    expect(plan.command).toEqual(expect.arrayContaining(['exec', '--json', '--sandbox', 'workspace-write', '--cd', '/tmp/agent-task']));
    expect(plan.command.at(-1)).toContain('Items render.');
  });

  it('reports CLI presence without claiming authenticated execution', () => {
    expect(probeCodexRuntime()).toMatchObject({ command: 'codex', executionVerified: false });
  });

  it('requires an explicit execute plan before starting a process', async () => {
    const task = { id: 'task-2', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] };
    const dryRun = buildAgentExecutionPlan(task, '/tmp/agent-task', 'codex');
    await expect(executeCodexPlan(dryRun, async () => {
      throw new Error('runner should not be called');
    })).rejects.toThrow('explicitly approved execute plan');
  });

  it('runs an explicitly approved plan through the injected process runner', async () => {
    const plan = buildAgentExecutionPlan({ id: 'task-3', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] }, '/tmp/agent-task', 'codex', { execute: true });
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
    const plan = buildAgentExecutionPlan({ id: 'task-5', title: 'Ignore signals', objective: 'Keep working.', acceptanceCriteria: ['Never finishes.'] }, process.cwd(), 'codex', { execute: true });
    const ignoresSigterm = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    const result = await executeCodexPlan({ ...plan, command: ['node', '-e', ignoresSigterm] }, runCodexProcess, 500);
    // The assertion is "the process was terminated", not which signal did it: on Windows
    // child.kill() terminates the process without POSIX signals, so signal stays null.
    expect(result.timedOut).toBe(true);
    if (process.platform === 'win32') {
      expect(result.exitCode).not.toBe(0);
    } else {
      expect(result.signal).toBe('SIGKILL');
    }
  }, 20_000);

  it('gives a real feature task more than three minutes by default', async () => {
    const plan = buildAgentExecutionPlan({ id: 'task-6', title: 'Add status', objective: 'Show status.', acceptanceCriteria: ['Status renders.'] }, '/tmp/agent-task', 'codex', { execute: true });
    let observed = 0;
    await executeCodexPlan(plan, async (_command, _arguments, options) => {
      observed = options.timeoutMs;
      return { exitCode: 0, signal: null, timedOut: false, output: '', startedAt: '2026-08-23T00:00:00.000Z', completedAt: '2026-08-23T00:00:01.000Z' };
    });
    expect(observed).toBeGreaterThan(180_000);
  });
});

// One rule answers "which Agent runs this task?" for every layer. Before it existed, the `local-`
// strip and the Profile lookup were copy-pasted per caller and the copies disagreed: a Blueprint
// naming a verified Agent was read as 'unsupported' and quietly swapped for Codex.
describe('Runtime executor resolution', () => {
  const noProfiles: () => Promise<AgentProfile | null> = async () => null;

  const profile = (id: string, baseAgentId: string): AgentProfile => ({
    id, name: id, baseAgentId, overrides: {},
    // Timestamps the store requires; irrelevant to the verdict.
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('reads a namespaced Blueprint provider as the Agent it names', async () => {
    expect(runtimeProviderAgentId('local-opencode')).toBe('opencode');
    // Agent Profile ids carry no prefix and pass through untouched.
    expect(runtimeProviderAgentId('reviewer')).toBe('reviewer');
    await expect(resolveRuntimeExecutor('local-opencode', noProfiles)).resolves.toMatchObject({
      ok: true, requestedId: 'local-opencode', agentId: 'opencode', adapterStatus: 'verified',
    });
  });

  it('refuses instead of substituting another Agent', async () => {
    await expect(resolveRuntimeExecutor('local-claude-code', noProfiles)).resolves.toMatchObject({
      ok: false, reason: 'unverified-adapter', agentId: 'claude-code', adapterStatus: 'candidate',
    });
    await expect(resolveRuntimeExecutor('local-my-cli', noProfiles)).resolves.toMatchObject({
      ok: false, reason: 'no-adapter', agentId: 'my-cli', adapterStatus: 'unsupported',
    });
  });

  it('follows a Profile to its base Agent and keeps the Profile for the plan', async () => {
    const reviewer = profile('reviewer', 'opencode');
    await expect(resolveRuntimeExecutor('reviewer', async id => (id === reviewer.id ? reviewer : null)))
      .resolves.toMatchObject({ ok: true, agentId: 'opencode', profile: reviewer });
  });

  it('keeps a Profile whose own id begins with the provider namespace', async () => {
    // Profile ids are slugs of user-chosen names, so `local-helper` can be a Profile id rather than a
    // namespaced provider. Stripping before the lookup sent that search looking for a Profile called
    // `helper`, found nothing, and judged the task by the leftover id - refusing a run the user had
    // configured on a verified Agent.
    const helper = profile('local-helper', 'hermes');
    const lookup = async (id: string) => (id === helper.id ? helper : null);
    await expect(resolveRuntimeExecutor('local-helper', lookup))
      .resolves.toMatchObject({ ok: true, agentId: 'hermes', profile: helper });
    // Reached through a Blueprint provider, the same Profile is still the executor.
    await expect(resolveRuntimeExecutor('local-local-helper', lookup))
      .resolves.toMatchObject({ ok: true, agentId: 'hermes', profile: helper });
  });

  it('refuses a Profile whose base Agent has no verified Adapter', async () => {
    // A Profile may exist on a base Agent that was verified when it was created and is not any more,
    // or was created through an injected verifier. Its prompt narrowing does not buy an execution
    // contract, and running the task on Codex instead would silently drop that prompt.
    const reviewer = profile('reviewer', 'claude-code');
    await expect(resolveRuntimeExecutor('reviewer', async id => (id === reviewer.id ? reviewer : null)))
      .resolves.toMatchObject({ ok: false, reason: 'unverified-adapter', agentId: 'claude-code' });
  });

  it('names the refused executor and offers no substitute', async () => {
    const refused = await resolveRuntimeExecutor('local-claude-code', noProfiles);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable: the Adapter registry changed underneath this case');
    expect(describeRuntimeExecutorRejection(refused)).toContain('claude-code');
    expect(describeRuntimeExecutorRejection(refused)).not.toMatch(/codex/i);

    const reviewer = profile('reviewer', 'aider');
    const refusedProfile = await resolveRuntimeExecutor('reviewer', async id => (id === reviewer.id ? reviewer : null));
    expect(refusedProfile.ok).toBe(false);
    if (refusedProfile.ok) throw new Error('unreachable: the Adapter registry changed underneath this case');
    // Saying only "Agent aider" would send the user looking for an Agent they never picked.
    expect(describeRuntimeExecutorRejection(refusedProfile)).toContain('Profile "reviewer"');
  });
});
