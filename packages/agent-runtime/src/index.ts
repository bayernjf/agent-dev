import { spawnSync } from 'node:child_process';

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

export type CodexExecutionPlan = {
  mode: 'dry-run';
  taskId: string;
  workspacePath: string;
  command: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  noExternalChanges: true;
  executionAllowed: false;
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

export function buildCodexExecutionPlan(task: ApprovedTask, workspacePath: string): CodexExecutionPlan {
  const prompt = [
    `Implement the approved feature task: ${task.title}`,
    `Objective: ${task.objective}`,
    'Acceptance criteria:',
    ...task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    'Work only in this task workspace. Do not access secrets, production systems, or paths outside the workspace.',
    'After implementation, summarize changed files and remaining risks. Do not claim acceptance without evidence.',
  ].join('\n');
  return {
    mode: 'dry-run',
    taskId: task.id,
    workspacePath,
    command: ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--cd', workspacePath, prompt],
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.codex', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: true,
    executionAllowed: false,
  };
}
