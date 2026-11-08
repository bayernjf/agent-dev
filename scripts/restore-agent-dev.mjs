#!/usr/bin/env node
// @ts-check
/**
 * Restore path for agent-dev snapshots produced by
 * `scripts/backup-agent-dev.mjs`.
 *
 *   1. verify the snapshot with `PRAGMA integrity_check` and key-table counts;
 *   2. refuse to overwrite a live database without `--force`;
 *   3. with `--force`, keep the current file as `.pre-restore-<stamp>` (0600);
 *   4. re-verify the copied file and fail if any key-table count moved.
 *
 * `~/.agent-dev/credentials.txt|json` is not part of the snapshot; restore it
 * from its own custodian before starting the daemon.
 *
 * CLI:
 *   node --experimental-sqlite scripts/restore-agent-dev.mjs \
 *     --snapshot ./backups/agent-dev-20261108-000000.db \
 *     [--target-db ./.agent-dev/agent-dev.sqlite] [--force]
 */
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire('node:sqlite');

/** Tables that must exist after a restore, in blast-radius order. */
const KEY_TABLES = [
  'projects',
  'blueprint_revisions',
  'delivery_runs',
  'baseline_approvals',
  'apply_runs',
  'release_runs',
];

class RestoreError extends Error {}

function stamp(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
}

/**
 * @param {string} dbFile
 * @returns {Record<string, number>}
 */
function verify(dbFile) {
  const db = new sqlite.DatabaseSync(dbFile, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const value = integrity === undefined ? '' : String(Object.values(integrity)[0] ?? '');
    if (value !== 'ok') throw new RestoreError(`integrity_check failed: ${value}`);

    /** @type {Record<string, number>} */
    const counts = {};
    for (const table of KEY_TABLES) {
      let row;
      try {
        row = db.prepare(`SELECT count(*) AS c FROM ${table}`).get();
      } catch {
        throw new RestoreError(
          `${dbFile} has no ${table} table; it is not a migrated agent-dev database`,
        );
      }
      counts[table] = Number(row?.c ?? 0);
    }
    return counts;
  } finally {
    db.close();
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{snapshot?: string, target?: string, force: boolean}} */
  const parsed = { force: argv.includes('--force') };
  for (const [flag, key] of /** @type {const} */ ([
    ['--snapshot', 'snapshot'],
    ['--target-db', 'target'],
  ])) {
    const index = argv.indexOf(flag);
    if (index >= 0) {
      const value = argv[index + 1];
      if (value === undefined) throw new RestoreError(`${flag} requires a value`);
      parsed[key] = value;
    }
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.snapshot === undefined) {
    throw new RestoreError(
      'usage: restore-agent-dev.mjs --snapshot <file.db> [--target-db <path>] [--force]',
    );
  }
  const snapshot = resolve(args.snapshot);
  if (!existsSync(snapshot)) throw new RestoreError(`snapshot not found: ${snapshot}`);

  const snapshotCounts = verify(snapshot);
  const target = resolve(
    args.target ?? process.env.AGENT_DEV_DATABASE_PATH ?? './.agent-dev/agent-dev.sqlite',
  );

  if (existsSync(target)) {
    if (!args.force) {
      throw new RestoreError(
        `target exists: ${target} — re-run with --force to overwrite (it will be kept as .pre-restore)`,
      );
    }
    const keepPath = `${target}.pre-restore-${stamp(new Date())}`;
    copyFileSync(target, keepPath);
    chmodSync(keepPath, 0o600);
    console.log(`kept previous db at ${keepPath}`);
  }

  copyFileSync(snapshot, target);
  chmodSync(target, 0o600);

  const restored = verify(target);
  for (const [table, expected] of Object.entries(snapshotCounts)) {
    if (restored[table] !== expected) {
      throw new RestoreError(
        `restored file does not match the snapshot: ${table} expected ${expected}, found ${String(restored[table])}`,
      );
    }
  }

  const counts = Object.entries(restored)
    .map(([table, count]) => `${table}=${count}`)
    .join(' ');
  console.log(`restored ${target} from ${snapshot} (${counts})`);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('restore-agent-dev.mjs') || process.argv[1].endsWith('restore-agent-dev'));

if (invokedAsScript) {
  try {
    main();
  } catch (err) {
    console.error(`restore-agent-dev: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
