import type { ProviderAdapter, ProviderPlan, ProviderPlanResource, ProviderState, ProviderVerification, ProviderDrift, ProviderApplyResult, ProviderApproval, ProviderResourceSpec } from '@agent-dev/provider-core';
import type { CommandRunner } from './cli.js';
import { defaultRunner } from './cli.js';
import { providerCredentialEnv } from './credentials.js';

type VercelProject = {
  id?: string;
  name?: string;
  accountId?: string;
  link?: { projectId?: string; orgId?: string };
  targets?: { production?: { url?: string } };
};

export class VercelAdapter implements ProviderAdapter {
  readonly providerId = 'vercel';

  constructor(
    private owner: string,
    private projectName: string,
    private workspacePath: string,
    private runner: CommandRunner = defaultRunner,
  ) {}

  private async inspectProject(): Promise<VercelProject | null> {
    const result = await this.runner('vercel', ['project', 'inspect', this.projectName, '--json'], {
      cwd: this.workspacePath,
      timeout: 30_000,
      env: { ...providerCredentialEnv(), CI: 'true' },
    });
    if (!result.success) return null;
    try { return JSON.parse(result.stdout) as VercelProject; } catch { return null; }
  }

  async discover(): Promise<ProviderState> {
    const result = await this.runner('vercel', ['project', 'ls'], { cwd: this.workspacePath, timeout: 30_000, env: { ...providerCredentialEnv(), CI: 'true' } });
    if (!result.success) return { providerId: this.providerId, resources: [] };
    const output = result.stdout || result.stderr;
    const exists = output.split('\n').some(line => line.trim().startsWith(this.projectName));
    if (!exists) return { providerId: this.providerId, resources: [] };
    const project = await this.inspectProject();
    const projectId = project?.id ?? project?.link?.projectId;
    const orgId = project?.accountId ?? project?.link?.orgId;
    const productionUrl = project?.targets?.production?.url;
    return {
      providerId: this.providerId,
      resources: [{
        id: 'vercel-api',
        kind: 'functions-project',
        owner: this.owner,
        createdAt: new Date().toISOString(),
        externalId: projectId,
        url: productionUrl,
        metadata: {
          projectName: project?.name ?? this.projectName,
          ...(orgId ? { orgId } : {}),
          ...(productionUrl ? { urlSource: 'cli-output' } : {}),
        },
      }],
    };
  }

  async plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan> {
    const discovered = current ?? await this.discover();
    const resources: ProviderPlanResource[] = spec.map(resource => {
      const existing = discovered.resources.find(candidate => candidate.id === resource.id);
      if (!existing) return { spec: resource, action: 'create' as const, reason: 'Vercel project does not exist yet.' };
      if (existing.owner !== resource.owner) return { spec: resource, action: 'update' as const, reason: `Vercel project owner mismatch: expected ${resource.owner}, found ${existing.owner}.` };
      return { spec: resource, action: 'noop' as const, reason: 'Vercel project already exists with the expected owner.' };
    });
    return {
      providerId: this.providerId,
      idempotencyKey: `vercel:${resources.map(r => `${r.spec.id}:${r.action}`).join('|')}`,
      noExternalChanges: true,
      resources,
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    if (plan.providerId !== this.providerId) throw new Error('Provider plan does not match this adapter.');
    if (approval.status !== 'approved') throw new Error('Provider Apply requires an approved plan.');
    for (const resource of plan.resources) {
      if (resource.action === 'noop') continue;
      await this.runner('vercel', ['project', 'add', this.projectName], { cwd: this.workspacePath, timeout: 30_000, env: { ...providerCredentialEnv(), CI: 'true' } });
      await this.runner('vercel', ['link', '--yes', '--project', this.projectName], { cwd: this.workspacePath, timeout: 30_000, env: { ...providerCredentialEnv(), CI: 'true' } });
      const result = await this.runner('vercel', ['deploy', '--prod', '--yes', '--no-wait'], { cwd: this.workspacePath, timeout: 120_000, env: { ...providerCredentialEnv(), CI: 'true' } });
      if (!result.success) throw new Error(`Vercel deployment failed: ${result.stderr || result.stdout}`);
    }
    return { providerId: this.providerId, idempotencyKey: plan.idempotencyKey, applied: true, state: await this.discover() };
  }

  async verify(expected: ProviderResourceSpec[]): Promise<ProviderVerification> {
    const actual = await this.discover();
    const missing = expected.filter(r => !actual.resources.some(c => c.id === r.id)).map(r => r.id);
    const mismatched = expected.filter(r => {
      const c = actual.resources.find(item => item.id === r.id);
      return Boolean(c && (c.owner !== r.owner || c.kind !== r.kind));
    }).map(r => r.id);
    return { providerId: this.providerId, verified: missing.length === 0 && mismatched.length === 0, missing, mismatched };
  }

  async detectDrift(expected: ProviderResourceSpec[]): Promise<ProviderDrift[]> {
    const actual = await this.discover();
    const drift: ProviderDrift[] = [];
    for (const resource of expected) {
      const candidate = actual.resources.find(item => item.id === resource.id);
      if (!candidate) drift.push({ resourceId: resource.id, type: 'missing', detail: 'Vercel project is absent from discovered state.' });
      else if (candidate.owner !== resource.owner) drift.push({ resourceId: resource.id, type: 'owner-mismatch', detail: `Expected owner ${resource.owner}, found ${candidate.owner}.` });
    }
    return drift;
  }
}
