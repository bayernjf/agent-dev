import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { lstat, readlink, access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import type { ProductBlueprint } from '@agent-dev/blueprint';
import { createBaselinePlan, createDryRunPlan, productBlueprintSchema } from '@agent-dev/blueprint';
import { buildAgentExecutionPlan, executeCodexPlan, isAgentExecutable, type CodexExecutionPlan, type CodexExecutionResult, type CodexProcessRunner } from '@agent-dev/agent-runtime';
import { createNeedsInputRun, restoreDeliveryActor, type DeliveryEvent, type DeliverySnapshot, type DeliveryState } from '@agent-dev/workflow';
import { applyRuns, baselineApprovals, blueprintRevisions, deliveryRuns, projects, releaseRuns } from './schema.js';
import { migrations } from './migrations.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

function createOrm(database: Database) {
  return drizzle(database, { schema: { applyRuns, baselineApprovals, projects, blueprintRevisions, deliveryRuns, releaseRuns } });
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

function createApplySteps(): ApplyStep[] {
  return [
    { id: 'validate-blueprint', title: 'Validate Blueprint revision', status: 'pending' },
    { id: 'create-workspace', title: 'Create isolated local workspace', status: 'pending' },
    { id: 'write-artifacts', title: 'Write generated delivery artifacts', status: 'pending' },
    { id: 'write-manifest', title: 'Write execution manifest', status: 'pending' },
    { id: 'initialize-git', title: 'Initialize local Git baseline', status: 'pending' },
    { id: 'create-feature-branch', title: 'Create local feature branch', status: 'pending' },
    { id: 'write-report', title: 'Write delivery report', status: 'pending' },
  ];
}

export type ApplyRun = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  recoveryIndex: number;
  workspacePath: string;
  steps: ApplyStep[];
  createdAt: string;
  updatedAt: string;
};

export type ApplyExecutionOptions = {
  failStep?: ApplyStep['id'];
};

// The release journal stores whatever steps the release composer produced. Keeping the step
// ids opaque here avoids a storage dependency on the composer just to name them.
export type ReleaseStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ReleaseRun = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  approvedBy: string;
  approvalSummary: string;
  steps: ReleaseStep[];
  createdAt: string;
  updatedAt: string;
};

export type ReleaseApprovalInput = {
  approvedBy: string;
  summary: string;
  steps: ReleaseStep[];
};

export type ReleaseEvidence = {
  projectName: string;
  apiBaseUrl: string;
  webUrl: string;
  corsOrigin: string;
  approvedBy: string;
  approvalSummary: string;
  observations: Record<string, unknown>;
  recordedAt: string;
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

export type RuntimeRun = {
  id: string;
  taskId: string;
  projectId: string;
  blueprintRevision: number;
  agentId: string;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
  plan: CodexExecutionPlan;
  result?: CodexExecutionResult;
  attempts: number;
  history: RuntimeAttempt[];
  createdAt: string;
  updatedAt: string;
};

export type RuntimeAttempt = {
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  plan: CodexExecutionPlan;
  result?: CodexExecutionResult;
  startedAt: string;
  completedAt?: string;
};

export type GitEvidence = {
  branch: string;
  head: string;
  status: string;
  diffStat: string;
};

export type PullRequestPublisher = (request: { branch: string; base: string; title: string; body: string }) => Promise<{ url: string; head: string }>;

export type PrEvidence = {
  url: string;
  checks: string[];
  recordedAt: string;
};

export type PreviewEvidence = {
  apiUrl: string;
  webUrl: string;
  smokeTest: string;
  recordedAt: string;
};

export type AcceptanceRecord = {
  id: string;
  projectId: string;
  blueprintRevision: number;
  taskId: string;
  status: 'blocked' | 'ready' | 'approved';
  criteriaConfirmed: boolean;
  summary: string;
  qualityStatus: 'passed' | 'failed' | 'missing';
  gitEvidence: GitEvidence;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

export class AgentDevStore {
  private readonly orm: ReturnType<typeof createOrm>;

  private constructor(
    private readonly sqlite: Database,
    private readonly databasePath: string,
  ) {
    this.orm = createOrm(sqlite);
  }

  /** Where the platform keeps its own state and the workspaces it creates. */
  get dataDirectory(): string {
    return dirname(this.databasePath);
  }

  static async open(databasePath: string) {    const SQL = await initSqlJs({
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
    const row = this.listApplyRuns(projectId, blueprintRevision)[0];
    return row ?? null;
  }

  // A recovery run is a second row for the same revision, so ordering has to be deterministic.
  // created_at alone is not: two inserts in the same millisecond would be interchangeable.
  listApplyRuns(projectId: string, blueprintRevision: number): ApplyRun[] {
    return this.orm.select().from(applyRuns)
      .where(eq(applyRuns.projectId, projectId))
      .orderBy(desc(applyRuns.recoveryIndex), desc(applyRuns.createdAt))
      .all()
      .filter(candidate => candidate.blueprintRevision === blueprintRevision)
      .map(row => this.parseApplyRun(row));
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
    const steps = createApplySteps();
    this.orm.insert(applyRuns).values({ id, projectId, blueprintRevision, status: 'queued', attempts: 0, recoveryIndex: 0, workspacePath, stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now }).run();
    await this.persist();
    return { id, projectId, blueprintRevision, status: 'queued', attempts: 0, recoveryIndex: 0, workspacePath, steps, createdAt: now, updatedAt: now };
  }

  // Recovery is a new workspace, not a repair of the old one. The failed workspace is left on disk
  // so its Git state stays inspectable, and the new run gets its own directory so a half-written
  // workspace cannot contaminate the retry.
  async createRecoveryApplyRun(projectId: string, blueprintRevision: number): Promise<ApplyRun> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} was not found.`);
    if (project.blueprint.metadata.revision !== blueprintRevision) throw new Error('Recovery must target the latest Blueprint revision.');
    if (!this.getBaselineApproval(projectId, blueprintRevision)) throw new Error('Approve the baseline before recovering a workspace.');
    const existing = this.listApplyRuns(projectId, blueprintRevision);
    if (existing.length === 0) throw new Error('There is no Apply run to recover; start Apply instead.');

    const now = new Date().toISOString();
    const id = randomUUID();
    const recoveryIndex = existing[0].recoveryIndex + 1;
    const workspacePath = join(dirname(this.databasePath), 'apply', projectId, `revision-${blueprintRevision}-recovery-${recoveryIndex}`);
    const steps = createApplySteps();
    this.orm.insert(applyRuns).values({ id, projectId, blueprintRevision, status: 'queued', attempts: 0, recoveryIndex, workspacePath, stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now }).run();
    await this.persist();
    return { id, projectId, blueprintRevision, status: 'queued', attempts: 0, recoveryIndex, workspacePath, steps, createdAt: now, updatedAt: now };
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
    await this.advanceDelivery(projectId, [{ type: 'START_IMPLEMENTATION' }]);
    return approved;
  }

  async prepareRuntimeRun(projectId: string, blueprintRevision: number, agentId = 'codex'): Promise<RuntimeRun> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task || task.status !== 'approved') throw new Error('Approve a Feature Task before preparing a Runtime run.');
    const existing = await this.getRuntimeRun(projectId, blueprintRevision);
    if (existing) return existing;
    const now = new Date().toISOString();
    const run: RuntimeRun = { id: randomUUID(), taskId: task.id, projectId, blueprintRevision, agentId, status: 'planned', plan: isAgentExecutable(agentId) ? buildAgentExecutionPlan(task, task.workspacePath, agentId) : buildAgentExecutionPlan(task, task.workspacePath, 'codex'), attempts: 0, history: [], createdAt: now, updatedAt: now };
    await writeFile(join(task.workspacePath, 'runtime-run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
    await writeFile(join(task.workspacePath, 'RUNTIME_RUN_REPORT.md'), this.buildRuntimeRunReport(run, await this.getGitEvidence(projectId, blueprintRevision)), 'utf8');
    await execFileAsync('git', ['add', 'runtime-run.json', 'RUNTIME_RUN_REPORT.md'], { cwd: task.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `runtime: prepare ${task.title}`], { cwd: task.workspacePath });
    return run;
  }

  async executeRuntimeRun(projectId: string, blueprintRevision: number, runner?: CodexProcessRunner): Promise<RuntimeRun> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task || task.status !== 'approved') throw new Error('Approve a Feature Task before executing Runtime.');
    const existing = await this.getRuntimeRun(projectId, blueprintRevision);
    if (!existing) throw new Error('Prepare a Runtime run before executing it.');
    if (existing.status === 'completed') return existing;
    if (existing.status === 'running') throw new Error('A Runtime run is already executing.');
    if (existing.status === 'cancelled') throw new Error('A cancelled Runtime run cannot be executed. Prepare a new run.');
    if (existing.status === 'failed') throw new Error('A failed Runtime run must be retried explicitly.');

    return this.executeRuntimeAttempt(task, existing, runner);
  }

  async retryRuntimeRun(projectId: string, blueprintRevision: number, runner?: CodexProcessRunner): Promise<RuntimeRun> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task || task.status !== 'approved') throw new Error('Approve a Feature Task before retrying Runtime.');
    const existing = await this.getRuntimeRun(projectId, blueprintRevision);
    if (!existing) throw new Error('No Runtime run is prepared.');
    if (existing.status !== 'failed') throw new Error('Only a failed Runtime run can be retried.');
    return this.executeRuntimeAttempt(task, existing, runner);
  }

  private async executeRuntimeAttempt(task: FeatureTask, existing: RuntimeRun, runner?: CodexProcessRunner): Promise<RuntimeRun> {
    const attemptNumber = existing.attempts + 1;
    const plan = buildAgentExecutionPlan(task, task.workspacePath, existing.agentId && isAgentExecutable(existing.agentId) ? existing.agentId : 'codex', { execute: true });
    const startedAt = new Date().toISOString();
    const attempt: RuntimeAttempt = { attempt: attemptNumber, status: 'running', plan, startedAt };

    const run: RuntimeRun = {
      ...existing,
      status: 'running',
      plan,
      attempts: attemptNumber,
      history: [...existing.history, attempt],
      updatedAt: startedAt,
    };
    await this.writeRuntimeRun(run, 'runtime: start Codex execution');

    let result: CodexExecutionResult;
    try {
      result = await executeCodexPlan(run.plan, runner);
    } catch (error) {
      result = {
        exitCode: null,
        signal: null,
        timedOut: false,
        output: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    const completed: RuntimeRun = {
      ...run,
      status: result.exitCode === 0 && !result.timedOut ? 'completed' : 'failed',
      result,
      updatedAt: result.completedAt,
      history: run.history.map(item => item.attempt === attemptNumber ? { ...item, status: result.exitCode === 0 && !result.timedOut ? 'completed' : 'failed', result, completedAt: result.completedAt } : item),
    };
    const blocked = completed.status === 'completed' ? await this.commitAgentChanges(task) : null;
    const output = blocked ? `${result.output}\n\n${blocked}` : result.output;
    const finished: RuntimeRun = blocked
      ? { ...completed, status: 'failed', result: { ...result, output }, history: completed.history.map(item => item.attempt === attemptNumber ? { ...item, status: 'failed', result: { ...result, output } } : item) }
      : completed;
    await this.writeRuntimeRun(finished, `runtime: ${finished.status}`);
    if (finished.status === 'completed') {
      await this.advanceDelivery(task.projectId, [{ type: 'IMPLEMENTATION_COMPLETE' }]);
    }
    return finished;
  }

  // Every other commit in the pipeline stages only the report file it just wrote, and the agent
  // never commits its own work. Without this step the branch that gets pushed and reviewed holds
  // the scaffold alone, so the feature a human accepted would silently not ship.
  // Returns a message when the commit must not happen, so the run is reported as failed instead.
  private async commitAgentChanges(task: FeatureTask): Promise<string | null> {
    await execFileAsync('git', ['add', '-A'], { cwd: task.workspacePath });
    const staged = await execFileAsync('git', ['status', '--porcelain'], { cwd: task.workspacePath });
    if (!staged.stdout.trim()) return null;
    // Workspaces generated before the scaffold shipped a .gitignore have no ignore rules at all, so
    // staging everything would put the generated .env — real provider credentials — into the product
    // repository. Committing a secret is not recoverable by a later fix.
    const secrets = staged.stdout.split('\n').map(line => line.slice(3).trim()).filter(path => /(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.env.example'));
    if (secrets.length) {
      await execFileAsync('git', ['reset', '-q'], { cwd: task.workspacePath });
      return `Agent changes were not committed: ${secrets.join(', ')} would enter the product repository. Add it to .gitignore in the workspace, then retry the run.`;
    }
    // Agents may speed up a test run by linking an existing node_modules from outside the
    // workspace. A committed absolute link is a dead path for every other clone, and removing it
    // later cannot rewrite the history it already entered.
    const stagedPaths = staged.stdout.split('\n').map(line => line.slice(3).trim()).filter(Boolean);
    const externalLinks: string[] = [];
    for (const path of stagedPaths) {
      const stats = await lstat(join(task.workspacePath, path)).catch(() => null);
      if (!stats?.isSymbolicLink()) continue;
      const target = await readlink(join(task.workspacePath, path));
      const resolved = resolve(task.workspacePath, target);
      const offset = relative(task.workspacePath, resolved);
      if (offset.startsWith('..') || isAbsolute(offset)) externalLinks.push(path);
    }
    if (externalLinks.length) {
      await execFileAsync('git', ['reset', '-q'], { cwd: task.workspacePath });
      return `Agent changes were not committed: ${externalLinks.join(', ')} ${externalLinks.length === 1 ? 'is a symbolic link' : 'are symbolic links'} outside the workspace and would enter the product repository as dead paths. Remove the link${externalLinks.length === 1 ? '' : 's'} in the workspace, then retry the run.`;
    }
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `feat: ${task.title}`], { cwd: task.workspacePath });
    return null;
  }

  async getRuntimeRun(projectId: string, blueprintRevision: number): Promise<RuntimeRun | null> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task) return null;
    try {
      const parsed = JSON.parse(await readFile(join(task.workspacePath, 'runtime-run.json'), 'utf8')) as RuntimeRun;
      return { ...parsed, agentId: parsed.agentId ?? 'codex', attempts: parsed.attempts ?? (parsed.result ? 1 : 0), history: parsed.history ?? (parsed.result ? [{ attempt: 1, status: parsed.status === 'completed' ? 'completed' : 'failed', plan: parsed.plan, result: parsed.result, startedAt: parsed.result.startedAt, completedAt: parsed.result.completedAt }] : []) };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async cancelRuntimeRun(projectId: string, blueprintRevision: number): Promise<RuntimeRun> {
    const run = await this.getRuntimeRun(projectId, blueprintRevision);
    if (!run) throw new Error('No Runtime run is prepared.');
    if (run.status === 'cancelled') return run;
    if (run.status === 'running') throw new Error('A running Runtime process must be cancelled through its process controller.');
    if (run.status === 'completed' || run.status === 'failed') throw new Error('A finished Runtime run cannot be cancelled.');
    const cancelled: RuntimeRun = { ...run, status: 'cancelled', updatedAt: new Date().toISOString() };
    await writeFile(join(run.plan.workspacePath, 'runtime-run.json'), JSON.stringify(cancelled, null, 2) + '\n', 'utf8');
    await writeFile(join(run.plan.workspacePath, 'RUNTIME_RUN_REPORT.md'), this.buildRuntimeRunReport(cancelled, await this.getGitEvidence(projectId, blueprintRevision)), 'utf8');
    await execFileAsync('git', ['add', 'runtime-run.json', 'RUNTIME_RUN_REPORT.md'], { cwd: run.plan.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', 'runtime: cancel dry-run'], { cwd: run.plan.workspacePath });
    return cancelled;
  }

  // Diagnosing the workspace being left behind is what makes recovery inspectable rather than a
  // silent do-over: whatever Git state the failed run reached is reported before the new run starts.
  async describeApplyWorkspace(runId: string): Promise<{ workspacePath: string; git: GitEvidence | null; gitReason?: string }> {
    const run = this.getApplyRun(runId);
    if (!run) throw new Error(`Apply run ${runId} was not found.`);
    try {
      const execute = async (args: string[]) => (await execFileAsync('git', args, { cwd: run.workspacePath })).stdout.trim();
      return {
        workspacePath: run.workspacePath,
        git: { branch: await execute(['branch', '--show-current']), head: await execute(['rev-parse', 'HEAD']), status: await execute(['status', '--short']), diffStat: await execute(['diff', '--stat']) },
      };
    } catch (error) {
      return { workspacePath: run.workspacePath, git: null, gitReason: error instanceof Error ? error.message : String(error) };
    }
  }

  async getGitEvidence(projectId: string, blueprintRevision: number): Promise<GitEvidence> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before collecting Git evidence.');
    const execute = async (args: string[]) => (await execFileAsync('git', args, { cwd: run.workspacePath })).stdout.trim();
    return { branch: await execute(['branch', '--show-current']), head: await execute(['rev-parse', 'HEAD']), status: await execute(['status', '--short']), diffStat: await execute(['diff', '--stat']) };
  }

  async submitAcceptance(projectId: string, blueprintRevision: number, summary: string, criteriaConfirmed: boolean): Promise<AcceptanceRecord> {
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task || task.status !== 'approved') throw new Error('Approve a Feature Task before submitting acceptance.');
    const quality = await this.getQualityGateResult(projectId, blueprintRevision);
    const gitEvidence = await this.getGitEvidence(projectId, blueprintRevision);
    const submittedAt = new Date().toISOString();
    const status: AcceptanceRecord['status'] = quality?.status === 'passed' && criteriaConfirmed ? 'ready' : 'blocked';
    const record: AcceptanceRecord = { id: randomUUID(), projectId, blueprintRevision, taskId: task.id, status, criteriaConfirmed, summary, qualityStatus: quality?.status ?? 'missing', gitEvidence, submittedAt };
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) throw new Error('A completed Local Apply run is required before submitting acceptance.');
    await writeFile(join(run.workspacePath, 'acceptance.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'ACCEPTANCE_REPORT.md'), this.buildAcceptanceReport(record), 'utf8');
    await execFileAsync('git', ['add', 'acceptance.json', 'ACCEPTANCE_REPORT.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `acceptance: ${status}`], { cwd: run.workspacePath });
    return record;
  }

  async getAcceptance(projectId: string, blueprintRevision: number): Promise<AcceptanceRecord | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try {
      return JSON.parse(await readFile(join(run.workspacePath, 'acceptance.json'), 'utf8')) as AcceptanceRecord;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async approveAcceptance(projectId: string, blueprintRevision: number, approvedBy: string): Promise<AcceptanceRecord> {
    const existing = await this.getAcceptance(projectId, blueprintRevision);
    if (!existing) throw new Error('Submit an acceptance record before approving delivery.');
    if (existing.status === 'blocked') throw new Error('Acceptance is blocked by missing quality or human evidence.');
    if (existing.status === 'approved') return existing;
    const record: AcceptanceRecord = { ...existing, status: 'approved', approvedBy, approvedAt: new Date().toISOString() };
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) throw new Error('A completed Local Apply run is required before approving delivery.');
    await writeFile(join(run.workspacePath, 'acceptance.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'ACCEPTANCE_REPORT.md'), this.buildAcceptanceReport(record), 'utf8');
    await execFileAsync('git', ['add', 'acceptance.json', 'ACCEPTANCE_REPORT.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', `acceptance: approve delivery`], { cwd: run.workspacePath });
    // Local approval closes implementation and local verification only. A real
    // PR, Preview, and production release remain provider-evidenced steps.
    await this.advanceDelivery(projectId, [{ type: 'IMPLEMENTATION_COMPLETE' }, { type: 'VERIFY_COMPLETE' }]);
    return record;
  }

  // The platform pushes the accepted commit and opens the pull request itself. Recording a URL a
  // human typed cannot show that the pull request carries the commit that was accepted.
  async publishPullRequest(projectId: string, blueprintRevision: number, publisher: PullRequestPublisher): Promise<PrEvidence> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('A pull request must target the current Blueprint revision.');
    const task = await this.getFeatureTask(projectId, blueprintRevision);
    if (!task) throw new Error('A Feature Task is required before opening a pull request.');
    const acceptance = await this.getAcceptance(projectId, blueprintRevision);
    if (!acceptance || acceptance.status !== 'approved') throw new Error('Approve the delivery before opening a pull request.');
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before opening a pull request.');
    const git = await this.getGitEvidence(projectId, blueprintRevision);
    // A dirty tree means work exists that the pull request would not contain.
    if (git.status) throw new Error(`Commit or discard the workspace changes before opening a pull request: ${git.status.split('\n').join(', ')}.`);
    const carriesAccepted = await execFileAsync('git', ['merge-base', '--is-ancestor', acceptance.gitEvidence.head, git.head], { cwd: run.workspacePath }).then(() => true).catch(() => false);
    // Not equality: the platform commits its own reports after acceptance, so HEAD moves on.
    if (!carriesAccepted) throw new Error(`The accepted commit ${acceptance.gitEvidence.head} is not part of ${git.branch}, so the pull request would not carry the accepted delivery.`);

    const quality = await this.getQualityGateResult(projectId, blueprintRevision);
    const published = await publisher({
      branch: git.branch,
      base: project.blueprint.spec.sourceControl.integrationBranch,
      title: task.title,
      body: `${acceptance.summary}\n\nAccepted commit: ${acceptance.gitEvidence.head}\nQuality gate: ${quality?.status ?? 'missing'} (${quality?.command ?? 'not run'})\n\nEvidence lives in ACCEPTANCE_REPORT.md, QUALITY_REPORT.md and RUNTIME_RUN_REPORT.md on this branch.`,
    });
    return this.recordPrEvidence(projectId, blueprintRevision, {
      url: published.url,
      checks: [
        `Local quality gate: ${quality?.status ?? 'missing'} (${quality?.command ?? 'not run'}, exit ${quality?.exitCode ?? 'none'})`,
        `Human acceptance: approved by ${acceptance.approvedBy ?? 'unknown'}`,
        `Pushed commit: ${published.head}`,
        'GitHub Actions: pending at pull request creation',
      ],
    });
  }

  async recordPrEvidence(projectId: string, blueprintRevision: number, evidence: Omit<PrEvidence, 'recordedAt'>): Promise<PrEvidence> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('PR evidence must target the current Blueprint revision.');
    if (project.state !== 'LOCAL_ACCEPTED') throw new Error(`PR evidence requires LOCAL_ACCEPTED state, current state is ${project.state}.`);
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before recording PR evidence.');
    const record: PrEvidence = { ...evidence, recordedAt: new Date().toISOString() };
    await writeFile(join(run.workspacePath, 'pr-evidence.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'PR_EVIDENCE.md'), `# Pull Request Evidence\n\n- URL: ${record.url}\n- Recorded: ${record.recordedAt}\n\n## Checks\n\n${record.checks.map(check => `- ${check}`).join('\n')}\n\nThis record proves a PR reference was supplied. GitHub review and Actions remain external evidence.\n`, 'utf8');
    await execFileAsync('git', ['add', 'pr-evidence.json', 'PR_EVIDENCE.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', 'delivery: record PR evidence'], { cwd: run.workspacePath });
    await this.advanceDelivery(projectId, [{ type: 'PR_CREATED' }]);
    return record;
  }

  async getPrEvidence(projectId: string, blueprintRevision: number): Promise<PrEvidence | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try { return JSON.parse(await readFile(join(run.workspacePath, 'pr-evidence.json'), 'utf8')) as PrEvidence; }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  }

  async recordPreviewEvidence(projectId: string, blueprintRevision: number, evidence: Omit<PreviewEvidence, 'recordedAt'>): Promise<PreviewEvidence> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('Preview evidence must target the current Blueprint revision.');
    if (project.state !== 'PR_OPEN') throw new Error(`Preview evidence requires PR_OPEN state, current state is ${project.state}.`);
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before recording Preview evidence.');
    const record: PreviewEvidence = { ...evidence, recordedAt: new Date().toISOString() };
    await writeFile(join(run.workspacePath, 'preview-evidence.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'PREVIEW_EVIDENCE.md'), `# Preview Evidence\n\n- API URL: ${record.apiUrl}\n- Web URL: ${record.webUrl}\n- Recorded: ${record.recordedAt}\n\n## Smoke test\n\n${record.smokeTest}\n\nThis record proves Preview evidence was supplied. Production deployment remains a separate approved step.\n`, 'utf8');
    await execFileAsync('git', ['add', 'preview-evidence.json', 'PREVIEW_EVIDENCE.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', 'delivery: record preview evidence'], { cwd: run.workspacePath });
    await this.advanceDelivery(projectId, [{ type: 'PREVIEW_AVAILABLE' }]);
    return record;
  }

  async getPreviewEvidence(projectId: string, blueprintRevision: number): Promise<PreviewEvidence | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try { return JSON.parse(await readFile(join(run.workspacePath, 'preview-evidence.json'), 'utf8')) as PreviewEvidence; }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  }

  getReleaseRun(runId: string): ReleaseRun | null {
    const row = this.orm.select().from(releaseRuns).where(eq(releaseRuns.id, runId)).get();
    return row ? this.parseReleaseRun(row) : null;
  }

  getLatestReleaseRun(projectId: string, blueprintRevision: number): ReleaseRun | null {
    const row = this.orm.select().from(releaseRuns)
      .where(eq(releaseRuns.projectId, projectId))
      .orderBy(desc(releaseRuns.createdAt))
      .all()
      .find(candidate => candidate.blueprintRevision === blueprintRevision);
    return row ? this.parseReleaseRun(row) : null;
  }

  // Asking for a release is not approving one. This only opens the approval gate.
  async requestRelease(projectId: string, blueprintRevision: number): Promise<StoredProject> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('A release request must target the current Blueprint revision.');
    if (project.state !== 'PREVIEW_READY') throw new Error(`A release can only be requested from PREVIEW_READY, current state is ${project.state}.`);
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before requesting a release.');
    return this.advanceDelivery(projectId, [{ type: 'REQUEST_RELEASE' }]);
  }

  async approveRelease(projectId: string, blueprintRevision: number, input: ReleaseApprovalInput): Promise<ReleaseRun> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('A release approval must target the current Blueprint revision.');
    if (project.state !== 'AWAITING_APPROVAL') throw new Error(`A release can only be approved from AWAITING_APPROVAL, current state is ${project.state}.`);
    if (!input.approvedBy.trim()) throw new Error('A release approval must name who approved it.');
    if (!input.summary.trim()) throw new Error('A release approval must record what is being released.');

    const now = new Date().toISOString();
    const id = randomUUID();
    const steps = input.steps.map(step => ({ ...step }));
    this.orm.insert(releaseRuns).values({
      id, projectId, blueprintRevision, status: 'queued', attempts: 0,
      approvedBy: input.approvedBy, approvalSummary: input.summary,
      stepsJson: JSON.stringify(steps), createdAt: now, updatedAt: now,
    }).run();
    await this.advanceDelivery(projectId, [{ type: 'APPROVE_RELEASE' }]);
    return { id, projectId, blueprintRevision, status: 'queued', attempts: 0, approvedBy: input.approvedBy, approvalSummary: input.summary, steps, createdAt: now, updatedAt: now };
  }

  async updateReleaseRun(runId: string, status: ReleaseRun['status'], steps: ReleaseStep[], attempts?: number): Promise<ReleaseRun> {
    const run = this.getReleaseRun(runId);
    if (!run) throw new Error(`Release run ${runId} was not found.`);
    const updatedAt = new Date().toISOString();
    const nextAttempts = attempts ?? run.attempts;
    this.orm.update(releaseRuns).set({ status, attempts: nextAttempts, stepsJson: JSON.stringify(steps), updatedAt }).where(eq(releaseRuns.id, runId)).run();
    await this.persist();
    return { ...run, status, attempts: nextAttempts, steps, updatedAt };
  }

  async failRelease(runId: string, steps: ReleaseStep[]): Promise<ReleaseRun> {
    const failed = await this.updateReleaseRun(runId, 'failed', steps);
    await this.advanceDelivery(failed.projectId, [{ type: 'FAIL' }]);
    return failed;
  }

  async recordReleaseEvidence(projectId: string, blueprintRevision: number, evidence: Omit<ReleaseEvidence, 'recordedAt'>): Promise<ReleaseEvidence> {
    const project = this.getProject(projectId);
    if (!project || project.blueprint.metadata.revision !== blueprintRevision) throw new Error('Release evidence must target the current Blueprint revision.');
    if (project.state !== 'RELEASING') throw new Error(`Release evidence requires RELEASING state, current state is ${project.state}.`);
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run || run.status !== 'completed') throw new Error('A completed Local Apply run is required before recording release evidence.');
    const record: ReleaseEvidence = { ...evidence, recordedAt: new Date().toISOString() };
    await writeFile(join(run.workspacePath, 'production-evidence.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    await writeFile(join(run.workspacePath, 'PRODUCTION_EVIDENCE.md'), this.buildReleaseEvidenceReport(record), 'utf8');
    await execFileAsync('git', ['add', 'production-evidence.json', 'PRODUCTION_EVIDENCE.md'], { cwd: run.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', 'delivery: record production release evidence'], { cwd: run.workspacePath });
    await this.advanceDelivery(projectId, [{ type: 'RELEASE_COMPLETE' }]);
    return record;
  }

  async getReleaseEvidence(projectId: string, blueprintRevision: number): Promise<ReleaseEvidence | null> {
    const run = this.getLatestApplyRun(projectId, blueprintRevision);
    if (!run) return null;
    try { return JSON.parse(await readFile(join(run.workspacePath, 'production-evidence.json'), 'utf8')) as ReleaseEvidence; }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  }

  private buildReleaseEvidenceReport(record: ReleaseEvidence): string {
    const observations = Object.entries(record.observations)
      .map(([key, value]) => `- ${key}: \`${JSON.stringify(value)}\``)
      .join('\n');
    return [
      '# Production Release Evidence',
      '',
      `- Product: ${record.projectName}`,
      `- API: ${record.apiBaseUrl}`,
      `- Web: ${record.webUrl}`,
      `- Allowed origin: ${record.corsOrigin}`,
      `- Approved by: ${record.approvedBy}`,
      `- Recorded: ${record.recordedAt}`,
      '',
      '## Approval',
      '',
      record.approvalSummary,
      '',
      '## Observations',
      '',
      observations || '- none recorded',
      '',
      'Every value above was observed against the deployed production URLs. A step without an',
      'observation cannot reach this report.',
      '',
    ].join('\n');
  }

  private parseReleaseRun(row: typeof releaseRuns.$inferSelect): ReleaseRun {
    return {
      id: row.id, projectId: row.projectId, blueprintRevision: row.blueprintRevision,
      status: row.status as ReleaseRun['status'], attempts: row.attempts,
      approvedBy: row.approvedBy, approvalSummary: row.approvalSummary,
      steps: JSON.parse(row.stepsJson) as ReleaseStep[],
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
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
    return { id: row.id, projectId: row.projectId, blueprintRevision: row.blueprintRevision, status: row.status as ApplyRun['status'], attempts: row.attempts, recoveryIndex: row.recoveryIndex, workspacePath: row.workspacePath, steps: JSON.parse(row.stepsJson) as ApplyStep[], createdAt: row.createdAt, updatedAt: row.updatedAt };
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

  private buildRuntimeRunReport(run: RuntimeRun, evidence: GitEvidence) {
    const result = run.result ? `\n## Execution result\n\n- Exit code: ${run.result.exitCode ?? 'none'}\n- Signal: ${run.result.signal ?? 'none'}\n- Timed out: ${run.result.timedOut}\n- Started: ${run.result.startedAt}\n- Completed: ${run.result.completedAt}\n\n\`\`\`text\n${run.result.output}\n\`\`\`\n` : '';
    const boundary = run.status === 'planned' || run.status === 'cancelled'
      ? 'This run records a guarded dry-run plan only. No Codex process was started and no feature code was changed.'
      : 'Codex execution was explicitly requested for this approved task. Quality Gate and human acceptance are still required.';
    const history = run.history.length ? `\n## Attempt history\n\n${run.history.map(item => `### Attempt ${item.attempt}\n\n- Status: ${item.status}\n- Started: ${item.startedAt}\n- Completed: ${item.completedAt ?? 'in progress'}\n- Exit code: ${item.result?.exitCode ?? 'none'}\n- Timed out: ${item.result?.timedOut ?? false}\n`).join('\n')}` : '';
    return `# Runtime Run Report\n\n- Run: ${run.id}\n- Task: ${run.taskId}\n- Agent: ${run.agentId}\n- Status: ${run.status}\n- Attempts: ${run.attempts}\n- Mode: ${run.plan.mode}\n- Execution allowed: ${run.plan.executionAllowed}\n- No external changes: ${run.plan.noExternalChanges}\n\n## Planned command\n\n\`\`\`text\n${run.plan.command.join(' ')}\n\`\`\`\n${history}${result}\n## Git evidence\n\n- Branch: ${evidence.branch}\n- HEAD: ${evidence.head}\n- Working tree: ${evidence.status || 'clean'}\n- Diff stat: ${evidence.diffStat || 'no changes'}\n\n## Boundary\n\n${boundary}\n`;
  }

  private async writeRuntimeRun(run: RuntimeRun, commitMessage: string) {
    await writeFile(join(run.plan.workspacePath, 'runtime-run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
    await writeFile(join(run.plan.workspacePath, 'RUNTIME_RUN_REPORT.md'), this.buildRuntimeRunReport(run, await this.getGitEvidence(run.projectId, run.blueprintRevision)), 'utf8');
    await execFileAsync('git', ['add', 'runtime-run.json', 'RUNTIME_RUN_REPORT.md'], { cwd: run.plan.workspacePath });
    await execFileAsync('git', ['-c', 'user.name=Agent-Dev Local', '-c', 'user.email=agent-dev@localhost', 'commit', '-qm', commitMessage], { cwd: run.plan.workspacePath });
  }

  private buildAcceptanceReport(record: AcceptanceRecord) {
    const blockers = [record.qualityStatus !== 'passed' ? `Quality Gate status is ${record.qualityStatus}.` : '', !record.criteriaConfirmed ? 'Human acceptance criteria confirmation is missing.' : ''].filter(Boolean);
    return `# Acceptance Report\n\n- Status: ${record.status}\n- Task: ${record.taskId}\n- Blueprint revision: ${record.blueprintRevision}\n- Quality Gate: ${record.qualityStatus}\n- Criteria confirmed: ${record.criteriaConfirmed}\n- Submitted: ${record.submittedAt}\n${record.approvedBy ? `- Approved by: ${record.approvedBy}\n- Approved at: ${record.approvedAt}\n` : ''}\n## Summary\n\n${record.summary}\n\n## Git evidence\n\n- Branch: ${record.gitEvidence.branch}\n- HEAD: ${record.gitEvidence.head}\n- Working tree: ${record.gitEvidence.status || 'clean'}\n- Diff: ${record.gitEvidence.diffStat || 'no changes'}\n\n## Blockers\n\n${blockers.length ? blockers.map(item => `- ${item}`).join('\n') : '- None'}\n\nThis report is the local human acceptance boundary. It does not claim a production deployment.\n`;
  }

  private async persist() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, this.sqlite.export());
  }
}
