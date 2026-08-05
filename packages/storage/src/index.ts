import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import type { ProductBlueprint } from '@agent-dev/blueprint';
import { createBaselinePlan, createDryRunPlan, productBlueprintSchema } from '@agent-dev/blueprint';
import { createNeedsInputRun, type DeliveryState } from '@agent-dev/workflow';
import { applyRuns, baselineApprovals, blueprintRevisions, deliveryRuns, projects } from './schema.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);

function createOrm(database: Database) {
  return drizzle(database, { schema: { applyRuns, baselineApprovals, projects, blueprintRevisions, deliveryRuns } });
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

export type BaselineApproval = {
  projectId: string;
  blueprintRevision: number;
  status: 'approved';
  approvedBy: string;
  approvedAt: string;
};

export type ApplyStep = {
  id: 'validate-blueprint' | 'create-workspace' | 'write-artifacts' | 'write-manifest' | 'write-report';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ApplyRun = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  workspacePath: string;
  steps: ApplyStep[];
  createdAt: string;
  updatedAt: string;
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

  async reviseProjectBlueprint(projectId: string, blueprint: ProductBlueprint): Promise<StoredProject> {
    const project = this.orm.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) throw new Error(`Project ${projectId} was not found.`);

    const latest = this.orm
      .select()
      .from(blueprintRevisions)
      .where(eq(blueprintRevisions.projectId, projectId))
      .orderBy(desc(blueprintRevisions.revision))
      .get();
    if (!latest) throw new Error(`Project ${projectId} has no Blueprint revision.`);
    if (blueprint.metadata.revision !== latest.revision + 1) {
      throw new Error(`Blueprint revision must be ${latest.revision + 1}.`);
    }

    const now = new Date().toISOString();
    try {
      this.sqlite.run('BEGIN IMMEDIATE;');
      this.orm.insert(blueprintRevisions).values({
        id: randomUUID(),
        projectId,
        revision: blueprint.metadata.revision,
        blueprintJson: JSON.stringify(blueprint),
        createdAt: now,
      }).run();
      this.orm.update(projects).set({
        productType: blueprint.spec.product.type,
        updatedAt: now,
      }).where(eq(projects.id, projectId)).run();
      this.sqlite.run('COMMIT;');
    } catch (error) {
      this.sqlite.run('ROLLBACK;');
      throw error;
    }

    await this.persist();
    const updated = this.getProject(projectId);
    if (!updated) throw new Error(`Project ${projectId} was not found after revision.`);
    return updated;
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

  getBaselineApproval(projectId: string, blueprintRevision: number): BaselineApproval | null {
    const approval = this.orm.select().from(baselineApprovals)
      .where(eq(baselineApprovals.projectId, projectId))
      .all()
      .find(row => row.blueprintRevision === blueprintRevision && row.status === 'approved');
    return approval ? {
      projectId: approval.projectId,
      blueprintRevision: approval.blueprintRevision,
      status: 'approved',
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
    } : null;
  }

  async approveBaseline(projectId: string, blueprintRevision: number, approvedBy: string): Promise<BaselineApproval> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    if (project.blueprint.metadata.revision !== blueprintRevision) {
      throw new Error('The approval must target the latest Blueprint revision.');
    }
    const plan = createBaselinePlan(project.blueprint);
    if (!plan.readyForApproval) throw new Error('Select every resource owner before approving the baseline.');

    const existing = this.getBaselineApproval(projectId, blueprintRevision);
    if (existing) return existing;

    const approvedAt = new Date().toISOString();
    const approval: BaselineApproval = {
      projectId,
      blueprintRevision,
      status: 'approved',
      approvedBy,
      approvedAt,
    };
    this.orm.insert(baselineApprovals).values({
      id: randomUUID(),
      projectId,
      blueprintRevision,
      status: approval.status,
      approvedBy,
      approvedAt,
    }).run();
    await this.persist();
    return approval;
  }

  getApplyRun(runId: string): ApplyRun | null {
    const row = this.orm.select().from(applyRuns).where(eq(applyRuns.id, runId)).get();
    return row ? this.parseApplyRun(row) : null;
  }

  getLatestApplyRun(projectId: string, blueprintRevision: number): ApplyRun | null {
    const row = this.orm.select().from(applyRuns)
      .where(eq(applyRuns.projectId, projectId))
      .orderBy(desc(applyRuns.createdAt))
      .all()
      .find(candidate => candidate.blueprintRevision === blueprintRevision);
    return row ? this.parseApplyRun(row) : null;
  }

  async createApplyRun(projectId: string, blueprintRevision: number): Promise<ApplyRun> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    if (project.blueprint.metadata.revision !== blueprintRevision) throw new Error('The apply must target the latest Blueprint revision.');
    if (!this.getBaselineApproval(projectId, blueprintRevision)) throw new Error('Approve the baseline before starting Apply.');
    const existing = this.getLatestApplyRun(projectId, blueprintRevision);
    if (existing && (existing.status === 'running' || existing.status === 'completed')) return existing;

    const now = new Date().toISOString();
    const id = randomUUID();
    const workspacePath = join(dirname(this.databasePath), 'apply', projectId, `revision-${blueprintRevision}`);
    const steps: ApplyStep[] = [
      { id: 'validate-blueprint', title: 'Validate Blueprint revision', status: 'pending' },
      { id: 'create-workspace', title: 'Create isolated local workspace', status: 'pending' },
      { id: 'write-artifacts', title: 'Write generated delivery artifacts', status: 'pending' },
      { id: 'write-manifest', title: 'Write execution manifest', status: 'pending' },
      { id: 'write-report', title: 'Write delivery report', status: 'pending' },
    ];
    this.orm.insert(applyRuns).values({ id, projectId, blueprintRevision, status: 'queued', workspacePath, stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now }).run();
    await this.persist();
    return { id, projectId, blueprintRevision, status: 'queued', workspacePath, steps, createdAt: now, updatedAt: now };
  }

  async executeApplyRun(runId: string): Promise<ApplyRun> {
    const run = this.getApplyRun(runId);
    if (!run) throw new Error(`Apply run ${runId} was not found.`);
    if (run.status === 'completed' || run.status === 'failed') return run;
    const project = this.getProject(run.projectId);
    if (!project || project.blueprint.metadata.revision !== run.blueprintRevision) throw new Error('Apply run no longer matches the current Blueprint revision.');
    const steps = run.steps.map(step => ({ ...step }));
    await this.updateApplyRun(run, 'running', steps);
    try {
      await this.runApplyStep(steps[0], async () => { productBlueprintSchema.parse(project.blueprint); });
      await this.runApplyStep(steps[1], async () => { await mkdir(run.workspacePath, { recursive: true }); });
      await this.runApplyStep(steps[2], async () => {
        for (const artifact of createDryRunPlan(project.blueprint).artifacts) {
          const target = join(run.workspacePath, artifact.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, artifact.content, 'utf8');
        }
      });
      await this.runApplyStep(steps[3], async () => {
        await writeFile(join(run.workspacePath, 'apply-manifest.json'), JSON.stringify({
          projectId: run.projectId,
          blueprintRevision: run.blueprintRevision,
          noExternalChanges: true,
          generatedAt: new Date().toISOString(),
          providerWrites: [],
          note: 'Local Apply Simulator only. No provider resource was created.',
        }, null, 2) + '\n', 'utf8');
      });
      await this.runApplyStep(steps[4], async () => {
        await writeFile(join(run.workspacePath, 'DELIVERY_REPORT.md'), this.buildDeliveryReport(run, project.blueprint.metadata.name, steps, 'completed'), 'utf8');
      });
      return await this.updateApplyRun(run, 'completed', steps);
    } catch (error) {
      const failed = steps.find(step => step.status === 'running');
      if (failed) failed.status = 'failed';
      if (failed) failed.detail = error instanceof Error ? error.message : String(error);
      if (run.workspacePath) {
        try {
          await mkdir(run.workspacePath, { recursive: true });
          await writeFile(join(run.workspacePath, 'DELIVERY_REPORT.md'), this.buildDeliveryReport(run, project.blueprint.metadata.name, steps, 'failed'), 'utf8');
        } catch {
          // Preserve the original step failure if the report itself cannot be written.
        }
      }
      return await this.updateApplyRun(run, 'failed', steps);
    }
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

  private parseApplyRun(row: typeof applyRuns.$inferSelect): ApplyRun {
    return { id: row.id, projectId: row.projectId, blueprintRevision: row.blueprintRevision, status: row.status as ApplyRun['status'], workspacePath: row.workspacePath, steps: JSON.parse(row.stepsJson) as ApplyStep[], createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  private async runApplyStep(step: ApplyStep, operation: () => Promise<void>) {
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    try {
      await operation();
      step.status = 'completed';
      step.completedAt = new Date().toISOString();
    } catch (error) {
      step.status = 'failed';
      step.detail = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async updateApplyRun(run: ApplyRun, status: ApplyRun['status'], steps: ApplyStep[]) {
    const updatedAt = new Date().toISOString();
    this.orm.update(applyRuns).set({ status, stepsJson: JSON.stringify(steps), updatedAt }).where(eq(applyRuns.id, run.id)).run();
    await this.persist();
    return { ...run, status, steps, updatedAt };
  }

  private buildDeliveryReport(run: ApplyRun, projectName: string, steps: ApplyStep[], status: 'completed' | 'failed') {
    const stepRows = steps.map(step => `| ${step.title} | ${step.status} | ${step.detail ?? ''} |`).join('\n');
    return `# ${projectName} Delivery Report\n\n- Blueprint revision: ${run.blueprintRevision}\n- Apply run: ${run.id}\n- Status: ${status}\n- Workspace: ${run.workspacePath}\n- External writes: none\n\n## Local evidence\n\n| Step | Result | Detail |\n| --- | --- | --- |\n${stepRows}\n\n## External actions not executed\n\n- No GitHub repository or branch was created.\n- No Supabase project, schema, or Auth configuration was changed.\n- No Vercel deployment was created.\n- No Cloudflare Pages project or deployment was created.\n\n## Recovery and rollback\n\nThis report describes the Local Apply Simulator only. Delete the ignored workspace directory to remove its generated files. A future provider Apply must provide idempotency keys, a provider diff, and an explicit rollback plan before executing remote writes.\n`;
  }

  private async persist() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, this.sqlite.export());
  }
}
