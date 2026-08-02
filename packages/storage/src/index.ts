import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import type { ProductBlueprint } from '@agent-dev/blueprint';
import { productBlueprintSchema } from '@agent-dev/blueprint';
import { createNeedsInputRun, type DeliveryState } from '@agent-dev/workflow';
import { blueprintRevisions, deliveryRuns, projects } from './schema.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);

function createOrm(database: Database) {
  return drizzle(database, { schema: { projects, blueprintRevisions, deliveryRuns } });
}

export type CreateProjectInput = {
  name: string;
  blueprint: ProductBlueprint;
};

export type ProjectSummary = {
  id: string;
  name: string;
  productType: string;
  state: DeliveryState;
  createdAt: string;
  updatedAt: string;
};

export type StoredProject = ProjectSummary & {
  blueprint: ProductBlueprint;
  runId: string;
  snapshot: unknown;
};

export class AgentDevStore {
  private readonly orm: ReturnType<typeof createOrm>;

  private constructor(
    private readonly sqlite: Database,
    private readonly databasePath: string,
  ) {
    this.orm = createOrm(sqlite);
  }

  static async open(databasePath: string) {
    const SQL = await initSqlJs({
      locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    });
    let data: Uint8Array | undefined;
    try {
      data = new Uint8Array(await readFile(databasePath));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }

    const store = new AgentDevStore(new SQL.Database(data), databasePath);
    store.sqlite.run('PRAGMA foreign_keys = ON;');
    store.runMigrations();
    await store.persist();
    return store;
  }

  async createProject(input: CreateProjectInput): Promise<StoredProject> {
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const runId = randomUUID();
    const revisionId = randomUUID();
    const actor = createNeedsInputRun({ projectId, runId });
    const state = actor.getSnapshot().value as DeliveryState;
    const snapshot = actor.getPersistedSnapshot();

    try {
      this.sqlite.run('BEGIN IMMEDIATE;');
      this.orm.insert(projects).values({
        id: projectId,
        name: input.name,
        productType: input.blueprint.spec.product.type,
        status: state,
        createdAt: now,
        updatedAt: now,
      }).run();
      this.orm.insert(blueprintRevisions).values({
        id: revisionId,
        projectId,
        revision: input.blueprint.metadata.revision,
        blueprintJson: JSON.stringify(input.blueprint),
        createdAt: now,
      }).run();
      this.orm.insert(deliveryRuns).values({
        id: runId,
        projectId,
        state,
        snapshotJson: JSON.stringify(snapshot),
        createdAt: now,
        updatedAt: now,
      }).run();
      this.sqlite.run('COMMIT;');
    } catch (error) {
      this.sqlite.run('ROLLBACK;');
      throw error;
    } finally {
      actor.stop();
    }

    await this.persist();
    return {
      id: projectId,
      name: input.name,
      productType: input.blueprint.spec.product.type,
      state,
      createdAt: now,
      updatedAt: now,
      blueprint: input.blueprint,
      runId,
      snapshot,
    };
  }

  listProjects(): ProjectSummary[] {
    const rows = this.orm
      .select({
        id: projects.id,
        name: projects.name,
        productType: projects.productType,
        state: deliveryRuns.state,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(deliveryRuns, eq(deliveryRuns.projectId, projects.id))
      .orderBy(desc(projects.updatedAt))
      .all();

    return rows.map(row => ({ ...row, state: row.state as DeliveryState }));
  }

  getProject(projectId: string): StoredProject | null {
    const project = this.orm.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return null;
    const blueprint = this.orm
      .select()
      .from(blueprintRevisions)
      .where(eq(blueprintRevisions.projectId, projectId))
      .orderBy(desc(blueprintRevisions.revision))
      .get();
    const run = this.orm
      .select()
      .from(deliveryRuns)
      .where(eq(deliveryRuns.projectId, projectId))
      .orderBy(desc(deliveryRuns.updatedAt))
      .get();
    if (!blueprint || !run) throw new Error(`Project ${projectId} has incomplete persisted state.`);

    return {
      id: project.id,
      name: project.name,
      productType: project.productType,
      state: run.state as DeliveryState,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      blueprint: productBlueprintSchema.parse(JSON.parse(blueprint.blueprintJson)),
      runId: run.id,
      snapshot: JSON.parse(run.snapshotJson),
    };
  }

  async close() {
    await this.persist();
    this.sqlite.close();
  }

  private runMigrations() {
    this.sqlite.run('CREATE TABLE IF NOT EXISTS __agent_dev_migrations (id TEXT PRIMARY KEY NOT NULL);');
    const result = this.sqlite.exec('SELECT id FROM __agent_dev_migrations;');
    const applied = new Set((result[0]?.values ?? []).map(row => String(row[0])));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      this.sqlite.run('BEGIN IMMEDIATE;');
      try {
        this.sqlite.exec(migration.sql);
        this.sqlite.run('INSERT INTO __agent_dev_migrations (id) VALUES (?);', [migration.id]);
        this.sqlite.run('COMMIT;');
      } catch (error) {
        this.sqlite.run('ROLLBACK;');
        throw error;
      }
    }
  }

  private async persist() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, this.sqlite.export());
  }
}
