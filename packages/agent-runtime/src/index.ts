import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

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
  const prompt = [
    `Implement the approved feature task: ${task.title}`,
    `Objective: ${task.objective}`,
    'Acceptance criteria:',
    ...task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    'Work only in this task workspace. Do not access secrets, production systems, or paths outside the workspace.',
    'After implementation, summarize changed files and remaining risks. Do not claim acceptance without evidence.',
  ].join('\n');
  return {
    mode: execute ? 'execute' : 'dry-run',
    taskId: task.id,
    workspacePath,
    command: ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--cd', workspacePath, prompt],
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.codex', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: !execute,
    executionAllowed: execute,
  };
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
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5_000).unref();
  }, options.timeoutMs);
  child.stdout?.on('data', chunk => { output = boundedAppend(output, String(chunk)); });
  child.stderr?.on('data', chunk => { output = boundedAppend(output, String(chunk)); });
  child.once('error', error => {
    clearTimeout(timeout);
    resolve({ exitCode: null, signal: null, timedOut, output: boundedAppend(output, error.message), startedAt, completedAt: new Date().toISOString() });
  });
  child.once('close', (exitCode, signal) => {
    clearTimeout(timeout);
    resolve({ exitCode, signal, timedOut, output, startedAt, completedAt: new Date().toISOString() });
  });
});

export async function executeCodexPlan(plan: CodexExecutionPlan, runner: CodexProcessRunner = runCodexProcess, timeoutMs = 180_000) {
  if (!plan.executionAllowed || plan.mode !== 'execute' || plan.noExternalChanges) {
    throw new Error('Codex execution requires an explicitly approved execute plan.');
  }
  return runner('codex', plan.command.slice(1), { cwd: plan.workspacePath, env: safeEnvironment(), timeoutMs });
}
