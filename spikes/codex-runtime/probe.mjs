import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(spikeDir, 'output');
const schemaPath = join(spikeDir, 'final-output.schema.json');
const writeMode = process.argv.includes('--write');
const timeoutMs = 180_000;

function redact(value) {
  return value.replace(/\bsk-[A-Za-z0-9_*.-]{4,}/g, 'sk-***');
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(redact(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout}`));
  }
  return redact((result.stdout || result.stderr).trim());
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-dev-codex-runtime-'));
  commandResult('git', ['init', '-b', 'main'], { cwd: directory });
  await writeFile(
    join(directory, 'README.md'),
    '# Codex Runtime Probe\n\nThis isolated repository contains one documentation file.\n',
    'utf8',
  );
  commandResult('git', ['add', 'README.md'], { cwd: directory });
  commandResult(
    'git',
    ['-c', 'user.name=Agent-Dev Spike', '-c', 'user.email=spike@agent-dev.invalid', 'commit', '-m', 'chore: initialize runtime fixture'],
    { cwd: directory },
  );
  return directory;
}

function runCodex(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);

    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

function parseEventTypes(jsonl) {
  const types = new Map();
  const invalidLines = [];
  for (const line of jsonl.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const type = typeof event.type === 'string' ? event.type : '<missing>';
      types.set(type, (types.get(type) || 0) + 1);
    } catch {
      invalidLines.push(line.slice(0, 160));
    }
  }
  return { types: Object.fromEntries(types), invalidLines };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const fixtureDir = await createFixture();
  const finalOutputPath = join(outputDir, writeMode ? 'write-final.json' : 'read-final.json');
  const eventsPath = join(outputDir, writeMode ? 'write-events.jsonl' : 'read-events.jsonl');
  const stderrPath = join(outputDir, writeMode ? 'write-stderr.log' : 'read-stderr.log');

  const prompt = writeMode
    ? 'Create RESULT.txt containing exactly codex-runtime-write-ok followed by a newline. Do not modify any other file. Return the required JSON object with a short summary and the files you observed.'
    : 'Inspect README.md without modifying any file. Return the required JSON object with a short summary and the files you observed.';

  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--ephemeral',
    '--sandbox',
    writeMode ? 'workspace-write' : 'read-only',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    finalOutputPath,
    '--cd',
    fixtureDir,
    prompt,
  ];

  const version = commandResult('codex', ['--version']);
  const result = await runCodex(args, fixtureDir);
  await writeFile(eventsPath, result.stdout, 'utf8');
  await writeFile(stderrPath, result.stderr, 'utf8');

  let finalOutput = null;
  try {
    finalOutput = JSON.parse(await readFile(finalOutputPath, 'utf8'));
  } catch {
    // The summary below reports a missing or invalid final output.
  }

  let writeVerification = null;
  if (writeMode) {
    try {
      writeVerification = (await readFile(join(fixtureDir, 'RESULT.txt'), 'utf8')) === 'codex-runtime-write-ok\n';
    } catch {
      writeVerification = false;
    }
  }

  const summary = {
    mode: writeMode ? 'workspace-write' : 'read-only',
    version,
    fixtureDir,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    eventSummary: parseEventTypes(result.stdout),
    finalOutput,
    writeVerification,
    stderrPresent: result.stderr.trim().length > 0,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (result.code !== 0 || result.timedOut || !finalOutput || (writeMode && !writeVerification)) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${redact(error.stack || error.message)}\n`);
  process.exitCode = 1;
});
