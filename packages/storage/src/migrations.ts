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
] as const;
