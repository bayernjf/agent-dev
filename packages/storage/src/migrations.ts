export const migrations = [
  {
    id: '0001_initial',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        product_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blueprint_revisions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        blueprint_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, revision),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS delivery_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        state TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `,
  },
  {
    id: '0002_baseline_approvals',
    sql: `
      CREATE TABLE IF NOT EXISTS baseline_approvals (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        blueprint_revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        UNIQUE(project_id, blueprint_revision),
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `,
  },
  {
    id: '0003_apply_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS apply_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        blueprint_revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `,
  },
  {
    id: '0004_apply_attempts',
    sql: `ALTER TABLE apply_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;`,
  },
] as const;
