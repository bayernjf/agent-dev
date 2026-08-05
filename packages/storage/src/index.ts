import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import type { ProductBlueprint } from '@agent-dev/blueprint';
import { createBaselinePlan, createDryRunPlan, productBlueprintSchema } from '@agent-dev/blueprint';
import { createNeedsInputRun, restoreDeliveryActor, type DeliveryEvent, type DeliverySnapshot, type DeliveryState } from '@agent-dev/workflow';
import { applyRuns, baselineApprovals, blueprintRevisions, deliveryRuns, projects } from './schema.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

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
  id: 'validate-blueprint' | 'create-workspace' | 'write-artifacts' | 'write-manifest' | 'initialize-git' | 'create-feature-branch' | 'write-report';
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
  attempts: number;
  workspacePath: string;
  steps: ApplyStep[];
  createdAt: string;
  updatedAt: string;
};

export type ApplyExecutionOptions = {
  failStep?: ApplyStep['id'];
};

export type QualityGateResult = {
  projectId: string;
  blueprintRevision: number;
  status: 'passed' | 'failed';
  command: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  output: string;
  workspacePath: string;
};

export type DependencyReadiness = {
  status: 'not-applied' | 'missing-dependencies' | 'ready';
  workspacePath: string | null;
  packageLockPresent: boolean;
  nodeModulesPresent: boolean;
  qualityCommandPresent: boolean;
  nextAction: string;
};

export type DependencyInstallResult = {
  projectId: string;
  blueprintRevision: number;
  status: 'installed' | 'failed';
  command: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  output: string;
  workspacePath: string;
};

export type FeatureTask = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  status: 'draft' | 'approved';
  approvedBy?: string;
  approvedAt?: string;
  workspacePath: string;
  createdAt: string;
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
    await this.advanceDelivery(projectId, [{ type: 'PLAN_COMPLETE' }, { type: 'APPROVE_PROVISIONING' }]);
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
    if (existing) return existing;

    const now = new Date().toISOString();
    const id = randomUUID();
    const workspacePath = join(dirname(this.databasePath), 'apply', projectId, `revision-${blueprintRevision}`);
    const steps: ApplyStep[] = [
      { id: 'validate-blueprint', title: 'Validate Blueprint revision', status: 'pending' },
      { id: 'create-workspace', title: 'Create isolated local workspace', status: 'pending' },
      { id: 'write-artifacts', title: 'Write generated delivery artifacts', status: 'pending' },
      { id: 'write-manifest', title: 'Write execution manifest', status: 'pending' },
      { id: 'initialize-git', title: 'Initialize local Git baseline', status: 'pending' },
      { id: 'create-feature-branch', title: 'Create local feature branch', status: 'pending' },
      { id: 'write-report', title: 'Write delivery report', status: 'pending' },
    ];
    this.orm.insert(applyRuns).values({ id, projectId, blueprintRevision, status: 'queued', attempts: 0, workspacePath, stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now }).run();
    await this.persist();
    return { id, projectId, blueprintRevision, status: 'queued', attempts: 0, workspacePath, steps, createdAt: now, updatedAt: now };
  }

  async executeApplyRun(runId: string, options: ApplyExecutionOptions = {}): Promise<ApplyRun> {
    const run = this.getApplyRun(runId);
    if (!run) throw new Error(`Apply run ${runId} was not found.`);
    if (run.status === 'completed') return run;
    if (run.attempts >= 3) return run;
    const project = this.getProject(run.projectId);
    if (!project || project.blueprint.metadata.revision !== run.blueprintRevision) throw new Error('Apply run no longer matches the current Blueprint revision.');
    const steps = run.steps.map(step => ({ ...step }));
    for (const step of steps) if (step.status === 'running' || step.status === 'failed') step.status = 'pending';
    const attempts = run.attempts + 1;
    await this.updateApplyRun(run, 'running', steps, attempts);
    try {
      await this.executePendingStep(run, steps[0], attempts, options, async () => { productBlueprintSchema.parse(project.blueprint); });
      await this.executePendingStep(run, steps[1], attempts, options, async () => { await mkdir(run.workspacePath, { recursive: true }); });
      await this.executePendingStep(run, steps[2], attempts, options, async () => {
        for (const artifact of createDryRunPlan(project.blueprint).artifacts) {
          const target = join(run.workspacePath, artifact.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, artifact.content, 'utf8');
        }
      });
      await this.executePendingStep(run, steps[3], attempts, options, async () => {
        await writeFile(join(run.workspacePath, 'apply-manifest.json'), JSON.stringify({
          projectId: run.projectId,
          blueprintRevision: run.blueprintRevision,
          noExternalChanges: true,
          generatedAt: new Date().toISOString(),
          providerWrites: [],
          note: 'Local Apply Simulator only. No provider resource was created.',
        }, null, 2) + '\n', 'utf8');
      });
      await this.executePendingStep(run, steps[4], attempts, options, async () => {
        await execFileAsync('git', ['init', '-q'], { cwd: run.workspacePath });
        await execFileAsync('git', ['add', '-A'], { cwd: run.workspacePath });
        try {
          await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: run.workspacePath });
        } catch {
          await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `chore: establish ${project.blueprint.metadata.name} baseline`], { cwd: run.workspacePath });
        }
      });
      await this.executePendingStep(run, steps[5], attempts, options, async () => {
        const featureBranch = `feature/agent-dev/revision-${run.blueprintRevision}`;
        const branches = await execFileAsync('git', ['branch', '--list', featureBranch], { cwd: run.workspacePath });
        if (branches.stdout.trim()) await execFileAsync('git', ['switch', featureBranch], { cwd: run.workspacePath });
        else await execFileAsync('git', ['switch', '-c', featureBranch], { cwd: run.workspacePath });
        const baselineCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: run.workspacePath })).stdout.trim();
        const manifestPath = join(run.workspacePath, 'apply-manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.git = { baselineCommit, featureBranch };
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        await execFileAsync('git', ['add', 'apply-manifest.json'], { cwd: run.workspacePath });
        await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '--amend', '--no-edit', '-q'], { cwd: run.workspacePath });
      });
      await this.executePendingStep(run, steps[6], attempts, options, async () => {
        await writeFile(join(run.workspacePath, 'DELIVERY_REPORT.md'), this.buildDeliveryReport(run, project.blueprint.metadata.name, steps, 'completed'), 'utf8');
        await execFileAsync('git', ['add', 'DELIVERY_REPORT.md'], { cwd: run.workspacePath });
        await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '--amend', '--no-edit', '-q'], { cwd: run.workspacePath });
      });
      const completed = await this.updateApplyRun(run, 'completed', steps, attempts);
      await this.advanceDelivery(run.projectId, [{ type: 'BASELINE_CREATED' }]);
      return completed;
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
      return await this.updateApplyRun(run, 'failed', steps, attempts);
    }
  }

  async runQualityGate(projectId: string, blueprintRevision: number): Promise<QualityGateResult> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before running the quality gate.');
    const command = 'npm run quality';
    const startedAt = new Date().toISOString();
    let status: QualityGateResult['status'] = 'passed';
    let exitCode = 0;
    let output = '';
    try {
      const result = await execFileAsync('npm', ['run', 'quality'], { cwd: run.workspacePath, timeout: 120_000, maxBuffer: 1_000_000 });
      output = `${result.stdout}${result.stderr}`.trim();
    } catch (error) {
      const cause = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      status = 'failed';
      exitCode = typeof cause.code === 'number' ? cause.code : 1;
      output = `${cause.stdout ?? ''}${cause.stderr ?? ''}${cause.message ?? ''}`.trim();
    }
    const completedAt = new Date().toISOString();
    const result: QualityGateResult = {
      projectId,
      blueprintRevision,
      status,
      command,
      exitCode,
      startedAt,
      completedAt,
      output,
      workspacePath: run.workspacePath,
    };
    await writeFile(join(run.workspacePath, 'quality-gate.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'QUALITY_REPORT.md'), this.buildQualityReport(result), 'utf8');
    try {
      await execFileAsync('git', ['add', 'quality-gate.json', 'QUALITY_REPORT.md'], { cwd: run.workspacePath });
      await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `chore: record quality gate ${status}`], { cwd: run.workspacePath });
    } catch {
      // The report remains available even if the local Git evidence commit cannot be created.
    }
    return result;
  }

  async getDependencyReadiness(projectId: string, blueprintRevision: number): Promise<DependencyReadiness> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') {
      return { status: 'not-applied', workspacePath: null, packageLockPresent: false, nodeModulesPresent: false, qualityCommandPresent: false, nextAction: 'Complete Local Apply before preparing dependencies.' };
    }
    const exists = async (path: string) => access(path).then(() => true).catch(() => false);
    const [packageLockPresent, nodeModulesPresent, qualityCommandPresent] = await Promise.all([
      exists(join(run.workspacePath, 'package-lock.json')),
      exists(join(run.workspacePath, 'node_modules')),
      exists(join(run.workspacePath, 'node_modules', '.bin', 'tsc')),
    ]);
    return qualityCommandPresent
      ? { status: 'ready', workspacePath: run.workspacePath, packageLockPresent, nodeModulesPresent, qualityCommandPresent, nextAction: 'Run the Local Quality Gate.' }
      : { status: 'missing-dependencies', workspacePath: run.workspacePath, packageLockPresent, nodeModulesPresent, qualityCommandPresent, nextAction: `Run npm install in ${run.workspacePath}, then refresh this status.` };
  }

  async getQualityGateResult(projectId: string, blueprintRevision: number): Promise<QualityGateResult | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try {
      return JSON.parse(await readFile(join(run.workspacePath, 'quality-gate.json'), 'utf8')) as QualityGateResult;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async installDependencies(projectId: string, blueprintRevision: number): Promise<DependencyInstallResult> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before installing dependencies.');
    const command = 'npm install';
    const startedAt = new Date().toISOString();
    let status: DependencyInstallResult['status'] = 'installed';
    let exitCode = 0;
    let output = '';
    try {
      const result = await execFileAsync('npm', ['install'], { cwd: run.workspacePath, timeout: 300_000, maxBuffer: 2_000_000 });
      output = `${result.stdout}${result.stderr}`.trim();
    } catch (error) {
      const cause = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      status = 'failed';
      exitCode = typeof cause.code === 'number' ? cause.code : 1;
      output = `${cause.stdout ?? ''}${cause.stderr ?? ''}${cause.message ?? ''}`.trim();
    }
    const completedAt = new Date().toISOString();
    const result: DependencyInstallResult = { projectId, blueprintRevision, status, command, exitCode, startedAt, completedAt, output, workspacePath: run.workspacePath };
    await writeFile(join(run.workspacePath, 'dependency-install.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'DEPENDENCY_INSTALL_REPORT.md'), this.buildDependencyInstallReport(result), 'utf8');
    try {
      await execFileAsync('git', ['add', 'dependency-install.json', 'DEPENDENCY_INSTALL_REPORT.md', 'package-lock.json'], { cwd: run.workspacePath });
      await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `chore: ${status === 'installed' ? 'record dependency installation' : 'record dependency installation failure'}`], { cwd: run.workspacePath });
    } catch {
      // Installation evidence remains available even when the local evidence commit fails.
    }
    return result;
  }

  async createFeatureTask(input: Omit<FeatureTask, 'id' | 'status' | 'workspacePath' | 'createdAt' | 'approvedBy' | 'approvedAt'>): Promise<FeatureTask> {
    const run = this.getLatestApplyRun(input.projectId, input.blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before creating a feature task.');
    const existing = await this.getFeatureTask(input.projectId, input.blueprintRevision);
    if (existing) return existing;
    const task: FeatureTask = { ...input, id: randomUUID(), status: 'draft', workspacePath: run.workspacePath, createdAt: new Date().toISOString() };
    await writeFile(join(run.workspacePath, 'feature-task.json'), JSON.stringify(task, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'FEATURE_TASK.md'), this.buildFeatureTask(task), 'utf8');
    await execFileAsync('git', ['add', 'feature-task.json', 'FEATURE_TASK.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `task: define ${task.title}`], { cwd: run.workspacePath });
    return task;
  }

  async getFeatureTask(projectId: string, blueprintRevision: number): Promise<FeatureTask | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try {
      return JSON.parse(await readFile(join(run.workspacePath, 'feature-task.json'), 'utf8')) as FeatureTask;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async approveFeatureTask(projectId: string, blueprintRevision: number, approvedBy: string): Promise<FeatureTask> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task) throw new Error('Create a feature task before approving it.');
    if (task.status === 'approved') return task;
    const approved: FeatureTask = { ...task, status: 'approved', approvedBy, approvedAt: new Date().toISOString() };
    await writeFile(join(task.workspacePath, 'feature-task.json'), JSON.stringify(approved, null, 2) + '\n', 'utf8');
    await writeFile(join(task.workspacePath, 'FEATURE_TASK.md'), this.buildFeatureTask(approved), 'utf8');
    await writeFile(join(task.workspacePath, 'TASK_APPROVAL.md'), `# Feature Task Approval\n\n- Task: ${approved.title}\n- Approved by: ${approved.approvedBy}\n- Approved at: ${approved.approvedAt}\n- Blueprint revision: ${approved.blueprintRevision}\n\nThe acceptance criteria in FEATURE_TASK.md are the governing human approval boundary for this task.\n`, 'utf8');
    await execFileAsync('git', ['add', 'feature-task.json', 'FEATURE_TASK.md', 'TASK_APPROVAL.md'], { cwd: task.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `task: approve ${approved.title}`], { cwd: task.workspacePath });
    return approved;
  }

  async close() {
    await this.persist();
    this.sqlite.close();
  }

  async advanceDelivery(projectId: string, events: DeliveryEvent[]): Promise<StoredProject> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    const actor = restoreDeliveryActor({ projectId: project.id, runId: project.runId }, project.snapshot as DeliverySnapshot);
    try {
      for (const event of events) actor.send(event);
      const snapshot = actor.getPersistedSnapshot();
      const state = actor.getSnapshot().value as DeliveryState;
      const updatedAt = new Date().toISOString();
      this.orm.update(deliveryRuns).set({ state, snapshotJson: JSON.stringify(snapshot), updatedAt }).where(eq(deliveryRuns.id, project.runId)).run();
      this.orm.update(projects).set({ status: state, updatedAt }).where(eq(projects.id, projectId)).run();
      await this.persist();
    } finally {
      actor.stop();
    }
    const updated = this.getProject(projectId);
    if (!updated) throw new Error(`Project ${projectId} was not found after state transition.`);
    return updated;
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
    return { id: row.id, projectId: row.projectId, blueprintRevision: row.blueprintRevision, status: row.status as ApplyRun['status'], attempts: row.attempts, workspacePath: row.workspacePath, steps: JSON.parse(row.stepsJson) as ApplyStep[], createdAt: row.createdAt, updatedAt: row.updatedAt };
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

  private async executePendingStep(run: ApplyRun, step: ApplyStep, attempts: number, options: ApplyExecutionOptions, operation: () => Promise<void>) {
    if (step.status === 'completed') return;
    await this.updateApplyRun(run, 'running', run.steps, attempts);
    if (options.failStep === step.id) {
      await this.runApplyStep(step, async () => { throw new Error(`Injected test failure at ${step.id}.`); });
      return;
    }
    await this.runApplyStep(step, operation);
    await this.updateApplyRun(run, 'running', run.steps, attempts);
  }

  private async updateApplyRun(run: ApplyRun, status: ApplyRun['status'], steps: ApplyStep[], attempts = run.attempts) {
    const updatedAt = new Date().toISOString();
    this.orm.update(applyRuns).set({ status, attempts, stepsJson: JSON.stringify(steps), updatedAt }).where(eq(applyRuns.id, run.id)).run();
    await this.persist();
    run.attempts = attempts;
    run.steps = steps;
    return { ...run, status, attempts, steps, updatedAt };
  }

  private buildDeliveryReport(run: ApplyRun, projectName: string, steps: ApplyStep[], status: 'completed' | 'failed') {
    const stepRows = steps.map(step => `| ${step.title} | ${step.status} | ${step.detail ?? ''} |`).join('\n');
    const featureBranch = `feature/agent-dev/revision-${run.blueprintRevision}`;
    return `# ${projectName} Delivery Report\n\n- Blueprint revision: ${run.blueprintRevision}\n- Apply run: ${run.id}\n- Status: ${status}\n- Workspace: ${run.workspacePath}\n- Local feature branch: ${featureBranch}\n- External writes: none\n\n## Local evidence\n\n| Step | Result | Detail |\n| --- | --- | --- |\n${stepRows}\n\n## External actions not executed\n\n- No GitHub repository or remote branch was created.\n- No Supabase project, schema, or Auth configuration was changed.\n- No Vercel deployment was created.\n- No Cloudflare Pages project or deployment was created.\n\n## Recovery and rollback\n\nThis report describes the Local Apply Simulator only. Delete the ignored workspace directory to remove its generated files. A future provider Apply must provide idempotency keys, a provider diff, and an explicit rollback plan before executing remote writes.\n`;
  }

  private buildQualityReport(result: QualityGateResult) {
    return `# Quality Gate Report\n\n- Status: ${result.status}\n- Command: \`${result.command}\`\n- Exit code: ${result.exitCode}\n- Blueprint revision: ${result.blueprintRevision}\n- Started: ${result.startedAt}\n- Completed: ${result.completedAt}\n\n## Output\n\n\`\`\`text\n${result.output || '(no output)'}\n\`\`\`\n\n## Boundary\n\nThis report was produced by the local Agent-Dev quality gate. A passed local gate does not replace GitHub Actions or human acceptance testing.\n`;
  }

  private buildDependencyInstallReport(result: DependencyInstallResult) {
    return `# Dependency Installation Report\n\n- Status: ${result.status}\n- Command: \`${result.command}\`\n- Exit code: ${result.exitCode}\n- Blueprint revision: ${result.blueprintRevision}\n- Started: ${result.startedAt}\n- Completed: ${result.completedAt}\n\n## Output\n\n\`\`\`text\n${result.output || '(no output)'}\n\`\`\`\n\n## Boundary\n\nThis installation was explicitly requested and ran only inside the local Agent-Dev workspace. No provider or production resource was changed.\n`;
  }

  private buildFeatureTask(task: FeatureTask) {
    return `# ${task.title}\n\n- Task ID: ${task.id}\n- Blueprint revision: ${task.blueprintRevision}\n- Status: ${task.status}\n- Created: ${task.createdAt}\n${task.approvedBy ? `- Approved by: ${task.approvedBy}\n- Approved at: ${task.approvedAt}\n` : ''}\n## Objective\n\n${task.objective}\n\n## Acceptance criteria\n\n${task.acceptanceCriteria.map((criterion, index) => `${index + 1}. [ ] ${criterion}`).join('\n')}\n\n## Agent boundary\n\nImplement only this task on the existing local feature branch. Run the configured quality gate and report evidence before requesting human acceptance.\n`;
  }

  private async persist() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, this.sqlite.export());
  }
}
