import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActor } from 'xstate';
import { deliveryMachine } from './machine.mjs';
import { initializeStore, loadHistory, loadRun, saveSnapshot } from './store.mjs';

const spikeDir = dirname(fileURLToPath(import.meta.url));
const [phase, databasePath] = process.argv.slice(2);

function transition(database, runId, actor, event) {
  const from = String(actor.getSnapshot().value);
  actor.send({ type: event });
  saveSnapshot(database, runId, actor, { event, from });
}

function startNew(database, runId) {
  const actor = createActor(deliveryMachine).start();
  saveSnapshot(database, runId, actor);
  return actor;
}

function resume(database, runId) {
  const stored = loadRun(database, runId);
  assert.ok(stored, `missing persisted run ${runId}`);
  return createActor(deliveryMachine, {
    snapshot: JSON.parse(stored.snapshot_json),
  }).start();
}

function runPhase(name, database) {
  initializeStore(database);

  if (name === 'gate-seed') {
    const actor = startNew(database, 'gate-run');
    transition(database, 'gate-run', actor, 'IMPLEMENTATION_FINISHED');
    transition(database, 'gate-run', actor, 'PREVIEW_READY');
    assert.equal(actor.getSnapshot().value, 'awaitingApproval');
    actor.stop();
  } else if (name === 'gate-resume') {
    const actor = resume(database, 'gate-run');
    assert.equal(actor.getSnapshot().value, 'awaitingApproval');
    transition(database, 'gate-run', actor, 'APPROVE');
    transition(database, 'gate-run', actor, 'RELEASE_SUCCEEDED');
    assert.equal(actor.getSnapshot().value, 'delivered');
    actor.stop();
  } else if (name === 'failure-seed') {
    const actor = startNew(database, 'failure-run');
    transition(database, 'failure-run', actor, 'IMPLEMENTATION_FINISHED');
    transition(database, 'failure-run', actor, 'VERIFICATION_FAILED');
    assert.equal(actor.getSnapshot().value, 'failed');
    actor.stop();
  } else if (name === 'failure-resume') {
    const actor = resume(database, 'failure-run');
    assert.equal(actor.getSnapshot().value, 'failed');
    transition(database, 'failure-run', actor, 'RETRY');
    assert.equal(actor.getSnapshot().value, 'verifying');
    assert.equal(actor.getSnapshot().context.retryCount, 1);
    transition(database, 'failure-run', actor, 'PREVIEW_READY');
    assert.equal(actor.getSnapshot().value, 'awaitingApproval');
    actor.stop();
  } else {
    throw new Error(`unknown phase: ${name}`);
  }

  const runId = name.startsWith('gate-') ? 'gate-run' : 'failure-run';
  const stored = loadRun(database, runId);
  process.stdout.write(`${JSON.stringify({ phase: name, state: stored.state })}\n`);
}

function invokePhase(name, database) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name, database], {
    cwd: spikeDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function main() {
  if (phase) {
    assert.ok(databasePath, 'database path is required for a phase');
    runPhase(phase, databasePath);
    return;
  }

  const temporaryRoot = join(spikeDir, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'resume-'));
  const database = join(temporaryDirectory, 'workflow.sqlite');
  try {
    const phases = [
      invokePhase('gate-seed', database),
      invokePhase('gate-resume', database),
      invokePhase('failure-seed', database),
      invokePhase('failure-resume', database),
    ];
    const result = {
      phases,
      gate: {
        state: loadRun(database, 'gate-run').state,
        history: loadHistory(database, 'gate-run'),
      },
      failure: {
        state: loadRun(database, 'failure-run').state,
        history: loadHistory(database, 'failure-run'),
      },
    };
    assert.equal(result.gate.state, 'delivered');
    assert.equal(result.failure.state, 'awaitingApproval');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
