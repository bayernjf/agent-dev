// OpenCode 2.0 driver for the Agent-Dev Runtime.
//
// OpenCode 2.0 (binary `lildax`) is a client-server CLI: it exposes `api`,
// `service`, and `serve` subcommands but not the v1 `-p --print` interface.
// A task therefore runs as a session on a local background server:
//
//   1. create a session scoped to the task workspace (and model),
//   2. submit the task prompt,
//   3. poll the session messages until the run finishes or fails,
//   4. stream the assistant text as process output.
//
// The driver is spawned by the same process runner as Codex, so it must print
// the execution result to stdout and exit 0 on success, non-zero on failure.
//
// Usage: node opencode2-driver.mjs <workspace> <model> <provider> [--prompt <file>]
//
// The prompt is read from the file given by --prompt so long prompts are not
// limited by argv length.
//
// Completion detection: the session `history` endpoint ignores its `limit`
// and `after` query parameters and always returns the first 50 events, so a
// driver that polls `history` can never observe the final `step.ended`. The
// `message` endpoint, by contrast, returns the newest messages first with full
// text and per-tool completion state, which is what we poll for completion.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OPENCODE = process.env.OPENCODE_BIN ?? 'opencode';
const SERVICE_URL = process.env.OPENCODE_SERVICE_URL ?? 'http://127.0.0.1:4096';
const POLL_INTERVAL_MS = Number(process.env.OPENCODE_POLL_INTERVAL_MS ?? '4000');
const MAX_OUTPUT_LENGTH = 2_000_000;
const SERVICE_START_TIMEOUT_MS = 15_000;

const args = process.argv.slice(2);
const workspace = args[0];
const model = args[1];
const provider = args[2];
const promptArg = args[3];
const promptFile = promptArg?.startsWith('--prompt=') ? promptArg.slice('--prompt='.length) : null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function boundedAppend(current, chunk) {
  const next = current + chunk;
  return next.length > MAX_OUTPUT_LENGTH ? `${next.slice(0, MAX_OUTPUT_LENGTH)}\n[output truncated]` : next;
}

function run(args, options = {}) {
  const result = spawnSync(OPENCODE, args, { encoding: 'utf8', ...options });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { status: result.status, output, error: result.error };
}

function ensureService() {
  const probe = run(['service', 'status']);
  if (probe.status === 0 && probe.output.includes('running')) return;
  console.log('OpenCode service is not running; starting it...');
  const started = run(['service', 'start'], { timeout: SERVICE_START_TIMEOUT_MS });
  if (started.status !== 0) fail(`Unable to start the OpenCode service: ${started.output}`);
}

function createSession() {
  const body = JSON.stringify({
    location: { directory: workspace },
    model: { id: model, providerID: provider },
  });
  const result = run(['api', 'POST', '/api/session', '--data', body]);
  if (result.status !== 0 || !result.output.trim()) fail(`OpenCode session create failed: ${result.output}`);
  try {
    return JSON.parse(result.output).data.id;
  } catch (error) {
    fail(`OpenCode session create returned no session id: ${result.output}`);
  }
}

function submitPrompt(sessionId) {
  const prompt = promptFile ? readFileSync(promptFile, 'utf8') : '';
  const body = JSON.stringify({ prompt: { text: prompt } });
  const result = run(['api', 'POST', `/api/session/${sessionId}/prompt`, '--data', body]);
  if (result.status !== 0) fail(`OpenCode prompt submit failed: ${result.output}`);
}

function readMessages(sessionId) {
  // The message endpoint returns newest messages first, with full text and
  // per-tool completion state. It accepts a cursor for older pages.
  const result = run(['api', 'GET', `/api/session/${sessionId}/message`]);
  if (result.status !== 0) return [];
  try {
    return JSON.parse(result.output).data ?? [];
  } catch {
    return [];
  }
}

// A run is finished when the newest assistant message has `finish === 'stop'`:
// the model produced its final text and no tool call is still waiting. The
// session message endpoint exposes this per-message terminal state directly,
// which is more reliable than guessing from content. While the model is still
// working the newest assistant message reports `finish === 'tool-calls'` (or a
// user/tool message follows), so we keep polling.
function isFinished(messages) {
  const newest = messages[0];
  if (!newest) return false;
  return (newest.type ?? '') === 'assistant' && (newest.finish ?? '') === 'stop';
}

// A run failed when the newest assistant message finished with an error, or any
// older message reports an error or a tool block reached a failed/error state.
function hasFailedStep(messages) {
  const newest = messages[0];
  if (newest && (newest.type ?? '') === 'assistant' && (newest.finish ?? '') === 'error') return true;
  for (const message of messages) {
    const content = message.content ?? [];
    for (const part of content) {
      if ((part.type ?? '') !== 'tool') continue;
      const status = (part.state ?? {}).status ?? '';
      if (status === 'failed' || status === 'error') return true;
    }
  }
  return false;
}

function summarize(messages) {
  let output = '';
  // The message endpoint returns newest first; walk from oldest to newest so
  // the assembled transcript reads top-down.
  for (const message of messages.slice().reverse()) {
    const content = message.content ?? [];
    const finish = message.finish;
    if (finish === 'error' && message.error?.message) {
      output = boundedAppend(output, `\n[error] ${message.error.message}\n`);
    }
    for (const part of content) {
      const kind = part.type ?? '';
      if (kind === 'text' && part.text) {
        output = boundedAppend(output, part.text);
      } else if (kind === 'reasoning' && part.text) {
        output = boundedAppend(output, `\n[reasoning] ${part.text}\n`);
      } else if (kind === 'tool') {
        const state = part.state ?? {};
        const status = state.status ?? '';
        const input = state.input ? ` ${JSON.stringify(state.input)}` : '';
        output = boundedAppend(output, `\n[tool] ${part.name ?? 'tool'}${status ? ` [${status}]` : ''}${input}\n`);
        const results = (state.content ?? []).filter(chunk => chunk?.type === 'text' && chunk.text);
        for (const chunk of results) {
          output = boundedAppend(output, chunk.text);
        }
      }
    }
  }
  return output;
}

function main() {
  if (!workspace || !model || !provider || !promptFile) {
    fail('Usage: node opencode2-driver.mjs <workspace> <model> <provider> --prompt=<file>');
  }

  ensureService();

  const sessionId = createSession();
  submitPrompt(sessionId);

  const deadline = Date.now() + Number(process.env.OPENCODE_TIMEOUT_MS ?? '900000');
  let messages = [];
  let finished = false;

  while (Date.now() < deadline) {
    messages = readMessages(sessionId);
    if (isFinished(messages)) {
      finished = true;
      break;
    }
    // Sleep in chunks so a long model turn does not stall the poll loop.
    const waitMs = Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (waitMs <= 0) break;
    const end = Date.now() + waitMs;
    while (Date.now() < end) {
      // busy-free sleep via Atomics.wait on a shared buffer
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }

  const output = summarize(messages);

  if (!finished) {
    console.log(output);
    console.error(`OpenCode run timed out after ${Date.now() - (deadline - Number(process.env.OPENCODE_TIMEOUT_MS ?? '900000'))}ms.`);
    process.exit(1);
  }

  const failed = hasFailedStep(messages);
  console.log(output);
  // Debug journal for post-mortem without exposing the token stream.
  if (process.env.OPENCODE_DRIVER_LOG) {
    const logDir = join(workspace, '.agent-dev');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `opencode-driver-${Date.now()}.json`);
    writeFileSync(logPath, JSON.stringify(messages.map(message => ({ type: message.type, id: message.id, finish: message.finish, content: message.content })), null, 2) + '\n');
  }
  process.exit(failed ? 1 : 0);
}

main();
