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
  {
    id: '0005_release_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS release_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        blueprint_revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        approved_by TEXT NOT NULL,
        approval_summary TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      -- A recovery run is a second apply row for the same revision. The index makes the
      -- ordering deterministic, which created_at alone is not for same-millisecond inserts.
      ALTER TABLE apply_runs ADD COLUMN recovery_index INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: '0006_rename_web_saas_product_type',
    sql: `
      -- 'web-saas' was renamed to 'web-app': SaaS names a business model while every other product
      -- type names a delivery shape. productBlueprintSchema is a strict enum and parses on every
      -- read, so a leftover value would throw and take down the whole project list, not just one
      -- row. The stored copy has to be rewritten here rather than tolerated by the schema.
      UPDATE projects SET product_type = 'web-app' WHERE product_type = 'web-saas';

      UPDATE blueprint_revisions
      SET blueprint_json = json_set(blueprint_json, '$.spec.product.type', 'web-app')
      WHERE json_extract(blueprint_json, '$.spec.product.type') = 'web-saas';
    `,
  },
] as const;
