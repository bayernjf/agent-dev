import { execFileSync } from 'node:child_process';

function sqlite(databasePath, sql, json = false) {
  const args = json ? ['-json', databasePath, sql] : [databasePath];
  const result = execFileSync('sqlite3', args, {
    encoding: 'utf8',
    input: json ? undefined : sql,
  }).trim();
  return json && result ? JSON.parse(result) : [];
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function initializeStore(databasePath) {
  sqlite(
    databasePath,
    `
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS delivery_runs (
        run_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS step_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES delivery_runs(run_id)
      ) STRICT;
    `,
  );
}

export function saveSnapshot(databasePath, runId, actor, transition = null) {
  const snapshot = actor.getPersistedSnapshot();
  const state = String(actor.getSnapshot().value);
  const now = new Date().toISOString();
  const statements = [
    `INSERT INTO delivery_runs (run_id, state, snapshot_json, updated_at)
     VALUES (${quote(runId)}, ${quote(state)}, ${quote(JSON.stringify(snapshot))}, ${quote(now)})
     ON CONFLICT(run_id) DO UPDATE SET
       state = excluded.state,
       snapshot_json = excluded.snapshot_json,
       updated_at = excluded.updated_at;`,
  ];

  if (transition) {
    statements.push(
      `INSERT INTO step_runs (run_id, event_type, from_state, to_state, created_at)
       VALUES (${quote(runId)}, ${quote(transition.event)}, ${quote(transition.from)}, ${quote(state)}, ${quote(now)});`,
    );
  }

  sqlite(databasePath, `BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;`);
}

export function loadRun(databasePath, runId) {
  const rows = sqlite(
    databasePath,
    `SELECT run_id, state, snapshot_json, updated_at FROM delivery_runs WHERE run_id = ${quote(runId)};`,
    true,
  );
  return rows[0] || null;
}

export function loadHistory(databasePath, runId) {
  return sqlite(
    databasePath,
    `SELECT event_type, from_state, to_state FROM step_runs WHERE run_id = ${quote(runId)} ORDER BY id;`,
    true,
  );
}
