import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export { discoverAgentRuntimes, probeAgentCapabilities, resolveExecutablePath, type AgentDescriptor, type AgentCapability, type CustomAgentInput, type AgentSource, type CapabilityProbe } from './catalog.js';
export {
  type AgentProfile,
  type AgentProfileOverrides,
  type ResolvedAgentConfig,
  type BaseAgentDefaults,
  agentProfileSchema,
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
  slugifyProfileName,
  ensureUniqueProfileId,
  mergeAgentConfig,
  validateProfileTools,
  validateProfileEnv,
  filterSafeEnv,
} from './profiles.js';
export {
  type PipelineStep,
  type PipelineStepStatus,
  type PipelineStepResult,
  type FeatureTaskPipeline,
  pipelineStepSchema,
  featureTaskPipelineSchema,
  createPipelineStepSchema,
  resolvePipelinePrompt,
  getNextPipelineStep,
  isPipelineComplete,
} from './pipeline.js';
export {
  type FailureCategory,
  type FailureSeverity,
  type FailureClassification,
  classifyFailure,
  categoryLabel,
  severityLabel,
} from './failure-classification.js';
export {
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorReport,
  runDoctor,
  formatDoctorSummary,
} from './doctor.js';
import type { AgentProfile } from './profiles.js';

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
  /** When the run uses an Agent Profile, this is the profile ID. */
  profileId?: string;
  /** Base agent ID resolved from the profile (or the direct agentId). */
  baseAgentId: string;
  /** Additional environment variables from profile overrides, merged into execution env. */
  profileEnv?: Record<string, string>;
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

export type AgentAdapterStatus = 'verified' | 'candidate' | 'unsupported';

type AgentAdapter = {
  buildCommand: (prompt: string, workspacePath: string) => string[];
  status: Exclude<AgentAdapterStatus, 'unsupported'>;
};

const AGENT_ADAPTERS: Record<string, AgentAdapter> = {
  // Adapters with status 'verified' have passed a locally exercised execution contract.
  // Candidate adapters are present but not yet verified end-to-end.
  codex: { status: 'verified', buildCommand: (prompt, cwd) => ['codex', 'exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--cd', cwd, prompt] },
  // Claude Code has no `--cwd` flag; the working directory is set by the spawn cwd option.
  // `--dangerously-skip-permissions` avoids interactive approval prompts in the isolated task workspace.
  // `--output-format json` gives structured output parseable by the same runner as Codex.
  'claude-code': { status: 'candidate', buildCommand: (prompt, cwd) => ['claude', '-p', prompt, '--allowedTools', 'Read,Write,Edit,Bash', '--dangerously-skip-permissions', '--output-format', 'json'] },
  // Aider has no `--cwd` flag; the working directory is set by the spawn cwd option.
  // `--message` sends a single prompt, `--yes-always` auto-accepts all prompts.
  aider: { status: 'candidate', buildCommand: (prompt, cwd) => ['aider', '--message', prompt, '--yes-always'] },
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
  // OpenClaw runs an embedded agent turn via `agent --local --agent main --message`. No `--cwd` flag;
  // the working directory is set by the spawn cwd option. `--json` gives structured output.
  openclaw: { status: 'candidate', buildCommand: (prompt, cwd) => ['openclaw', 'agent', '--local', '--agent', 'main', '--message', prompt, '--json'] },
  // CodeBuddy runs non-interactively via `-p`, with permissions bypassed because it executes inside
  // an already-isolated task workspace. `--no-session-persistence` keeps each run stateless.
  // Execution contract exercised locally: `codebuddy -p ... "READY"` returned the response and
  // exited 0, and the child is captured through the same stdout/stderr runner as Codex.
  codebuddy: { status: 'verified', buildCommand: (prompt, cwd) => ['codebuddy', '-p', '--permission-mode', 'bypassPermissions', '--no-session-persistence', prompt] },
  // Hermes one-shot mode: `-z PROMPT` prints only the final response to stdout.
  // `--in DIR` sets the working directory, `--yolo` bypasses dangerous command approvals.
  // Execution contract exercised locally: `hermes -z "Create hello.txt" --in /tmp --yolo`
  // created the file with correct content and exited 0.
  hermes: { status: 'verified', buildCommand: (prompt, cwd) => ['hermes', '-z', prompt, '--in', cwd, '--yolo'] },
};

export function buildAgentExecutionPlan(
  task: ApprovedTask,
  workspacePath: string,
  agentId: string,
  options: { execute?: boolean; profile?: AgentProfile } = {},
): CodexExecutionPlan {
  const execute = options.execute === true;
  const profile = options.profile;
  // When a profile is provided, resolve the base agent from the profile.
  const resolvedAgentId = profile?.baseAgentId ?? agentId;
  const basePrompt = buildTaskPrompt(task);
  // Append profile system prompt after the task prompt.
  const prompt = profile?.overrides.systemPrompt
    ? `${basePrompt}\n\n---\n${profile.overrides.systemPrompt}`
    : basePrompt;
  const adapter = AGENT_ADAPTERS[resolvedAgentId];
  if (!adapter) throw new Error(`Agent "${resolvedAgentId}" does not have a candidate execution adapter.`);
  if (execute && adapter.status !== 'verified') throw new Error(`Agent "${resolvedAgentId}" has a candidate adapter but has not passed execution verification.`);
  return {
    mode: execute ? 'execute' : 'dry-run',
    taskId: task.id,
    workspacePath,
    command: adapter.buildCommand(prompt, workspacePath),
    forbiddenPaths: ['.env', '.env.*', '.git/config', '~/.ssh', 'production secrets'],
    acceptanceCriteria: task.acceptanceCriteria,
    noExternalChanges: !execute,
    executionAllowed: execute,
    profileId: profile?.id,
    baseAgentId: resolvedAgentId,
    profileEnv: profile?.overrides.env,
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
  const env = { ...safeEnvironment(), ...(plan.profileEnv ?? {}) };
  return runner(plan.command[0], plan.command.slice(1), { cwd: plan.workspacePath, env, timeoutMs });
}
