#!/usr/bin/env node
// @ts-check
/**
 * agent-dev SQLite backup (2026-11-08 baseline gap: project, blueprint,
 * delivery/apply/release and approval state lived only in a local file).
 *
 * `VACUUM INTO` produces a consistent snapshot while the daemon keeps running
 * (node:sqlite, no external tooling). Any failure exits non-zero and prints
 * FAILED, so a cron job or CI wrapper cannot mistake a dead backup for success.
 *
 * NOT included: `~/.agent-dev/credentials.txt|json` (mode 0600). Those are
 * secrets; keep them in a separate secret store, not in this snapshot.
 *
 * Env:
 *   AGENT_DEV_DATABASE_PATH  live database (default ./.agent-dev/agent-dev.sqlite)
 *   BACKUP_DIR               snapshot directory (default ./backups)
 *   RETENTION_DAYS           delete snapshots older than N days (default 7)
 *
 * Usage:
 *   node --experimental-sqlite scripts/backup-agent-dev.mjs
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire('node:sqlite');

const DB_PATH = resolve(
  process.env.AGENT_DEV_DATABASE_PATH ?? './.agent-dev/agent-dev.sqlite',
);
const BACKUP_DIR = resolve(process.env.BACKUP_DIR ?? './backups');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? '7');
const PREFIX = 'agent-dev-';

/** `YYYYMMDD-HHMMSS` in UTC. */
function stamp(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
}

function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!name.startsWith(PREFIX) || !name.endsWith('.db')) continue;
    const full = join(BACKUP_DIR, name);
    if (statSync(full).mtimeMs < cutoff) {
      unlinkSync(full);
      console.log(`pruned ${full} (older than ${RETENTION_DAYS} days)`);
    }
  }
}

function main() {
  if (!Number.isInteger(RETENTION_DAYS) || RETENTION_DAYS < 1) {
    throw new Error(`RETENTION_DAYS must be a positive integer, got ${process.env.RETENTION_DAYS}`);
  }
  if (!existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);

  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const out = join(BACKUP_DIR, `${PREFIX}${stamp(new Date())}.db`);
  if (existsSync(out)) throw new Error(`snapshot already exists: ${out}`);

  const db = new sqlite.DatabaseSync(DB_PATH);
  try {
    db.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }

  chmodSync(out, 0o600);
  console.log(`wrote ${out} (${statSync(out).size} bytes, retention ${RETENTION_DAYS} days)`);
  prune();
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('backup-agent-dev.mjs') || process.argv[1].endsWith('backup-agent-dev'));

if (invokedAsScript) {
  try {
    main();
  } catch (err) {
    console.error(`[backup-agent-dev] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
