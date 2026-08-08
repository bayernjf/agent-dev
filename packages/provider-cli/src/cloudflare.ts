import type { ProviderAdapter, ProviderPlan, ProviderPlanResource, ProviderState, ProviderVerification, ProviderDrift, ProviderApplyResult, ProviderApproval, ProviderResourceSpec } from '@agent-dev/provider-core';
import type { CommandRunner } from './cli.js';
import { defaultRunner } from './cli.js';
import { providerCredentialEnv } from './credentials.js';

export class CloudflareAdapter implements ProviderAdapter {
  readonly providerId = 'cloudflare';
  private readonly distPath: string;

  constructor(
    private owner: string,
    private projectName: string,
    private workspacePath: string,
    private runner: CommandRunner = defaultRunner,
  ) {
    this.distPath = `${workspacePath}/apps/web/dist`;
  }

  async discover(): Promise<ProviderState> {
    const result = await this.runner('npx', ['wrangler', 'pages', 'project', 'list'], { cwd: this.workspacePath, timeout: 60_000, env: providerCredentialEnv() });
    if (!result.success) return { providerId: this.providerId, resources: [] };
    const exists = result.stdout.split('\n').some(line => line.trim().includes(this.projectName));
    if (!exists) return { providerId: this.providerId, resources: [] };
    return {
      providerId: this.providerId,
      resources: [{
        id: 'cloudflare-pages',
        kind: 'pages-project',
        owner: this.owner,
        createdAt: new Date().toISOString(),
      }],
    };
  }

  async plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan> {
    const discovered = current ?? await this.discover();
    const resources: ProviderPlanResource[] = spec.map(resource => {
      const existing = discovered.resources.find(candidate => candidate.id === resource.id);
      if (!existing) return { spec: resource, action: 'create' as const, reason: 'Cloudflare Pages project does not exist yet.' };
      if (existing.owner !== resource.owner) return { spec: resource, action: 'update' as const, reason: `Cloudflare account mismatch: expected ${resource.owner}, found ${existing.owner}.` };
      return { spec: resource, action: 'noop' as const, reason: 'Cloudflare Pages project already exists with the expected account.' };
    });
    return {
      providerId: this.providerId,
      idempotencyKey: `cloudflare:${resources.map(r => `${r.spec.id}:${r.action}`).join('|')}`,
      noExternalChanges: true,
      resources,
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    if (plan.providerId !== this.providerId) throw new Error('Provider plan does not match this adapter.');
    if (approval.status !== 'approved') throw new Error('Provider Apply requires an approved plan.');
    for (const resource of plan.resources) {
      if (resource.action === 'noop') continue;
      const createResult = await this.runner('npx', ['wrangler', 'pages', 'project', 'create', this.projectName, '--production-branch', 'main'], { cwd: this.workspacePath, timeout: 60_000, env: providerCredentialEnv() });
      if (!createResult.success) throw new Error(`Cloudflare Pages project creation failed: ${createResult.stderr || createResult.stdout}`);
      const deployResult = await this.runner('npx', ['wrangler', 'pages', 'deploy', this.distPath, '--project-name', this.projectName], { cwd: this.workspacePath, timeout: 180_000, env: providerCredentialEnv() });
      if (!deployResult.success) throw new Error(`Cloudflare Pages deployment failed: ${deployResult.stderr || deployResult.stdout}`);
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
      if (!candidate) drift.push({ resourceId: resource.id, type: 'missing', detail: 'Cloudflare Pages project is absent from discovered state.' });
      else if (candidate.owner !== resource.owner) drift.push({ resourceId: resource.id, type: 'owner-mismatch', detail: `Expected account ${resource.owner}, found ${candidate.owner}.` });
    }
    return drift;
  }
}
