# Backup and restore (agent-dev)

Last drill: **2026-11-08** (restore executed against the real local database).
Standard: `bayjf/docs/ops/backup-restore-baseline-2026-11-08.md`.

## 1. Does agent-dev have state worth backing up?

Yes. The daemon persists delivery state in a local SQLite file; it is not
stateless and the state is not hosted externally.

| Evidence | What it shows |
|---|---|
| `apps/daemon/src/index.ts:40-45` | default database `<workspace>/.agent-dev/agent-dev.sqlite` (`AGENT_DEV_DATABASE_PATH` overrides) |
| `packages/storage/src/migrations.ts` | tables `projects`, `blueprint_revisions`, `delivery_runs`, `baseline_approvals`, `apply_runs`, `release_runs` |
| `.agent-dev/agent-dev.sqlite` | real local database (139264 bytes, modified 2026-11-02) |

If this file is lost, project records, blueprint revisions, apply/release runs
and baseline approvals are gone; there is no upstream copy. That is why a
backup task exists here.

Not covered by the snapshot (secrets / regenerable):

- `~/.agent-dev/credentials.json` (or legacy `credentials.txt`), mode `0600` —
  provider tokens and API keys. Keep them in a separate secret store; a
  database snapshot cannot decrypt or recreate them.
- `~/.agent-dev/daemon-token` — regenerated on daemon start if missing, but
  clients must then re-read the new token. It is not part of the snapshot.

## 2. Schedule, retention, location

- **Frequency**: daily (one snapshot per day). There is no sidecar because
  agent-dev is a local developer tool; use cron, for example:

  ```cron
  0 9 * * * cd /path/to/agent-dev && /usr/bin/env node --experimental-sqlite scripts/backup-agent-dev.mjs >> .agent-dev/backup.log 2>&1
  ```

- **Retention**: 7 days (`RETENTION_DAYS=7`); older `agent-dev-*.db` files are
  pruned after each successful snapshot.
- **Location**: `./backups` by default (or `BACKUP_DIR`), i.e. the same machine
  and usually the same disk as `.agent-dev/`.

> **Limitation:** snapshots sit on the same host as the live database. If the
> machine or its disk is lost, both are lost. Copy snapshots to separate storage
> if you need disaster recovery; this setup does not provide it.

Snapshots are written with mode `0600`.

## 3. Backup commands

```bash
# Default paths: ./.agent-dev/agent-dev.sqlite -> ./backups/agent-dev-<stamp>.db
node --experimental-sqlite scripts/backup-agent-dev.mjs
# or
npm run backup
```

Custom paths:

```bash
AGENT_DEV_DATABASE_PATH=/path/to/agent-dev.sqlite \
BACKUP_DIR=/path/to/backups RETENTION_DAYS=7 \
  node --experimental-sqlite scripts/backup-agent-dev.mjs
```

The snapshot is a consistent `VACUUM INTO` copy; the daemon does not need to
stop. A failure prints `[backup-agent-dev] FAILED: ...` and exits non-zero,
so a cron wrapper cannot silently report success.

## 4. Restore

```bash
node --experimental-sqlite scripts/restore-agent-dev.mjs \
  --snapshot ./backups/agent-dev-20261108-135706.db \
  --target-db ./.agent-dev/agent-dev.sqlite --force
```

Behaviour:

- verifies the snapshot with `PRAGMA integrity_check` (`ok` required) and the
  six key tables;
- if the target exists, requires `--force` and keeps the previous file as
  `<target>.pre-restore-<stamp>` (`0600`);
- re-verifies the written file and fails if any key-table count differs from the
  snapshot.

Restore the credentials from their own custodian before starting the daemon;
the snapshot intentionally does not contain them.

## 5. Drill record (2026-11-08, actual output)

Run against the real local database (no synthetic fixture):

```bash
BACKUP_DIR=/tmp/drill-agent-dev/backups RETENTION_DAYS=7 \
  node --experimental-sqlite scripts/backup-agent-dev.mjs
node --experimental-sqlite scripts/restore-agent-dev.mjs \
  --snapshot /tmp/drill-agent-dev/backups/agent-dev-20261108-135706.db \
  --target-db /tmp/drill-agent-dev/restored.db
```

Actual output:

```text
wrote /tmp/drill-agent-dev/backups/agent-dev-20261108-135706.db (139264 bytes, retention 7 days)
-rw------- 139264 /tmp/drill-agent-dev/backups/agent-dev-20261108-135706.db
restored /tmp/drill-agent-dev/restored.db from /tmp/drill-agent-dev/backups/agent-dev-20261108-135706.db
  (projects=10 blueprint_revisions=26 delivery_runs=10 baseline_approvals=9 apply_runs=11 release_runs=3)
-rw------- 139264 /tmp/drill-agent-dev/restored.db
```

What the drill proves: the real database snapshots to a `0600` file, restores
with identical counts across all six tables (10 projects, 26 blueprint
revisions, 10 delivery runs, 9 approvals, 11 apply runs, 3 release runs), and
passes `integrity_check`.

What it does not prove: cross-machine recovery (the snapshot is local) or that
credentials survive — they are deliberately excluded.
