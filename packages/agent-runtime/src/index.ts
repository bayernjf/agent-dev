import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export { discoverAgentRuntimes, probeAgentCapabilities, type AgentDescriptor, type AgentCapability, type CustomAgentInput, type AgentSource, type CapabilityProbe } from './catalog.js';

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NO_COLOR'];
const MAX_OUTPUT_LENGTH = 2_000_000;

export type ApprovedTask = {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
};

export type CodexRuntimeProbe = {
  command: 'codex';
  available: boolean;
  version: string | null;
  executionVerified: false;
  reason: string;
};

export type CodexExecutionResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
  startedAt: string;
  completedAt: string;
};

export type CodexExecutionPlan = {
  mode: 'dry-run' | 'execute';
  taskId: string;
  workspacePath: string;
  command: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  noExternalChanges: boolean;
  executionAllowed: boolean;
};

export function probeCodexRuntime(): CodexRuntimeProbe {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return {
    command: 'codex',
    available: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
    executionVerified: false,
    reason: result.error ? 'Codex CLI is not available on PATH.' : 'CLI presence is detected, but authenticated write execution is not verified.',
  };
}

export function buildCodexExecutionPlan(task: ApprovedTask, workspacePath: string, options: { execute?: boolean } = {}): CodexExecutionPlan {
  const execute = options.execute === true;
  const prompt = buildTaskPrompt(task);
  return {
    mode: execute ? 'execute' : 'dry-run',
    taskId: task.id,
    workspacePath,
    command: ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--cd', workspacePath, prompt],
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.codex', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: !execute,
    executionAllowed: execute,
  };
}

export type AgentAdapterStatus = 'verified' | 'candidate' | 'unsupported';

type AgentAdapter = {
  buildCommand: (prompt: string, workspacePath: string) => string[];
  status: Exclude<AgentAdapterStatus, 'unsupported'>;
};

const AGENT_ADAPTERS: Record<string, AgentAdapter> = {
  // Codex is the only adapter with a locally exercised execution contract.
  codex: { status: 'verified', buildCommand: (prompt, cwd) => ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--cd', cwd, prompt] },
  'claude-code': { status: 'candidate', buildCommand: (prompt, cwd) => ['claude', '-p', prompt, '--allowedTools', 'Read,Write,Edit,Bash', '--cwd', cwd] },
  aider: { status: 'candidate', buildCommand: (prompt, cwd) => ['aider', '--message', prompt, '--yes', '--cwd', cwd] },
  // OpenCode 2.0 (`lildax`) dropped the v1 `-p --print` interface, so tasks run through the
  // session-based driver script. The default model is the free `nemotron-3-ultra-free` from the
  // built-in `opencode` provider: it is the strongest free model verified working on the Zen
  // gateway (1M context / 128K output), avoiding the exhausted paid/plan quota that blocks Codex
  // and the deprecated/rate-limited free models (`hy3-free`, `big-pickle`, `ling-3.0-flash-free`).
  // Execution contract exercised locally: the driver wrote a file, ran `ls`, and exited 0.
  opencode: { status: 'verified', buildCommand: (prompt, cwd) => {
    const promptDir = join(tmpdir(), 'agent-dev-opencode');
    mkdirSync(promptDir, { recursive: true });
    const promptFile = join(promptDir, `${randomUUID()}.md`);
    writeFileSync(promptFile, prompt);
    const driver = fileURLToPath(new URL('../scripts/opencode2-driver.mjs', import.meta.url));
    return ['node', driver, cwd, 'nemotron-3-ultra-free', 'opencode', `--prompt=${promptFile}`];
  } },
  openclaw: { status: 'candidate', buildCommand: (prompt, cwd) => ['openclaw', 'exec', '--json', '--sandbox', 'workspace-write', '--cd', cwd, prompt] },
  // CodeBuddy runs non-interactively via `-p`, with permissions bypassed because it executes inside
  // an already-isolated task workspace. `--no-session-persistence` keeps each run stateless.
  // Execution contract exercised locally: `codebuddy -p ... "READY"` returned the response and
  // exited 0, and the child is captured through the same stdout/stderr runner as Codex.
  codebuddy: { status: 'verified', buildCommand: (prompt, cwd) => ['codebuddy', '-p', '--permission-mode', 'bypassPermissions', '--no-session-persistence', prompt] },
};

export function buildAgentExecutionPlan(task: ApprovedTask, workspacePath: string, agentId: string, options: { execute?: boolean } = {}): CodexExecutionPlan {
  const execute = options.execute === true;
  const prompt = buildTaskPrompt(task);
  const adapter = AGENT_ADAPTERS[agentId];
  if (!adapter) throw new Error(`Agent "${agentId}" does not have a candidate execution adapter.`);
  if (execute && adapter.status !== 'verified') throw new Error(`Agent "${agentId}" has a candidate adapter but has not passed execution verification.`);
  return {
    mode: execute ? 'execute' : 'dry-run',
    taskId: task.id,
    workspacePath,
    command: adapter.buildCommand(prompt, workspacePath),
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: !execute,
    executionAllowed: execute,
  };
}

export function isAgentExecutable(agentId: string): boolean {
  return AGENT_ADAPTERS[agentId]?.status === 'verified';
}

export function getAgentAdapterStatus(agentId: string): AgentAdapterStatus {
  return AGENT_ADAPTERS[agentId]?.status ?? 'unsupported';
}

function buildTaskPrompt(task: ApprovedTask): string {
  return [
    `Implement the approved feature task: ${task.title}`,
    `Objective: ${task.objective}`,
    'Acceptance criteria:',
    ...task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    'Work only in this task workspace. Do not access secrets, production systems, or paths outside the workspace.',
    'After implementation, summarize changed files and remaining risks. Do not claim acceptance without evidence.',
  ].join('\n');
}

function boundedAppend(current: string, chunk: string) {
  const next = current + chunk;
  return next.length > MAX_OUTPUT_LENGTH ? `${next.slice(0, MAX_OUTPUT_LENGTH)}\n[output truncated]` : next;
}

function safeEnvironment() {
  return Object.fromEntries(SAFE_ENV_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key] as string]] : []));
}

export type CodexProcessRunner = (command: string, arguments_: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<CodexExecutionResult>;

export const runCodexProcess: CodexProcessRunner = (command, arguments_, options) => new Promise(resolve => {
  const startedAt = new Date().toISOString();
  const child: ChildProcess = spawn(command, arguments_, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let timedOut = false;
  let exited = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    // `child.killed` only records that a signal was delivered, so it is already true here and can
    // never report whether the process actually died. An agent that keeps working through SIGTERM
    // has to be escalated against observed exit, otherwise the timeout bounds nothing.
    setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, 5_000).unref();
  }, options.timeoutMs);
  child.stdout?.on('data', chunk => { output = boundedAppend(output, String(chunk)); });
  child.stderr?.on('data', chunk => { output = boundedAppend(output, String(chunk)); });
  child.once('error', error => {
    exited = true;
    clearTimeout(timeout);
    resolve({ exitCode: null, signal: null, timedOut, output: boundedAppend(output, error.message), startedAt, completedAt: new Date().toISOString() });
  });
  child.once('close', (exitCode, signal) => {
    exited = true;
    clearTimeout(timeout);
    resolve({ exitCode, signal, timedOut, output, startedAt, completedAt: new Date().toISOString() });
  });
});

// A real feature task spends most of its wall clock inside model turns, not inside the shell. The
// first live run on this machine was still reading files at 5m22s, so a three-minute bound cut off
// work that was progressing normally and reported it as a failure.
const DEFAULT_EXECUTION_TIMEOUT_MS = 900_000;

export async function executeCodexPlan(plan: CodexExecutionPlan, runner: CodexProcessRunner = runCodexProcess, timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS) {
  if (!plan.executionAllowed || plan.mode !== 'execute' || plan.noExternalChanges) {
    throw new Error('Agent execution requires an explicitly approved execute plan.');
  }
  return runner(plan.command[0], plan.command.slice(1), { cwd: plan.workspacePath, env: safeEnvironment(), timeoutMs });
}
