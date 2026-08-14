import type { ProviderAdapter, ProviderPlan, ProviderPlanResource, ProviderState, ProviderVerification, ProviderDrift, ProviderApplyResult, ProviderApproval, ProviderResourceSpec } from '@agent-dev/provider-core';
import type { CommandRunner } from './cli.js';
import { defaultRunner, runCliJson } from './cli.js';
import { providerCredentialEnv } from './credentials.js';

type GhRepo = {
  id?: string;
  name: string;
  owner: { login: string } | string;
  isPrivate: boolean;
  url?: string;
};

export class GitHubAdapter implements ProviderAdapter {
  readonly providerId = 'github';

  constructor(
    private owner: string,
    private projectName: string,
    private workspacePath: string,
    private runner: CommandRunner = defaultRunner,
  ) {}

  private runGh(args: string[], options: Parameters<CommandRunner>[2] = {}) {
    return this.runner('gh', args, {
      ...options,
      env: { ...providerCredentialEnv(), ...options.env },
    });
  }

  private async resolveOwner(): Promise<string> {
    if (this.owner) return this.owner;
    const result = await this.runGh(['api', 'user', '--jq', '.login']);
    return result.success ? result.stdout.trim() : '';
  }

  private async resolveRepoFullName(): Promise<string> {
    const owner = await this.resolveOwner();
    return `${owner}/${this.projectName}`;
  }

  async discover(): Promise<ProviderState> {
    const fullName = await this.resolveRepoFullName();
    const repo = await runCliJson<GhRepo>(this.runner, 'gh', ['repo', 'view', fullName, '--json', 'id,name,owner,isPrivate,url'], {
      env: providerCredentialEnv(),
    });
    if (!repo) return { providerId: this.providerId, resources: [] };
    const ownerLogin = typeof repo.owner === 'string' ? repo.owner : repo.owner?.login ?? '';
    return {
      providerId: this.providerId,
      resources: [{
        id: 'github-repository',
        kind: 'repository',
        owner: ownerLogin,
        createdAt: new Date().toISOString(),
        externalId: repo.id,
        url: repo.url ?? `https://github.com/${ownerLogin}/${repo.name}`,
        metadata: { repository: `${ownerLogin}/${repo.name}`, private: String(repo.isPrivate) },
      }],
    };
  }

  async plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan> {
    const discovered = current ?? await this.discover();
    const resources: ProviderPlanResource[] = spec.map(resource => {
      const existing = discovered.resources.find(candidate => candidate.id === resource.id);
      if (!existing) return { spec: resource, action: 'create' as const, reason: 'GitHub repository does not exist yet.' };
      if (existing.owner !== resource.owner) return { spec: resource, action: 'update' as const, reason: `Repository owner mismatch: expected ${resource.owner}, found ${existing.owner}.` };
      return { spec: resource, action: 'noop' as const, reason: 'GitHub repository already exists with the expected owner.' };
    });
    return {
      providerId: this.providerId,
      idempotencyKey: `github:${resources.map(r => `${r.spec.id}:${r.action}`).join('|')}`,
      noExternalChanges: true,
      resources,
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    if (plan.providerId !== this.providerId) throw new Error('Provider plan does not match this adapter.');
    if (approval.status !== 'approved') throw new Error('Provider Apply requires an approved plan.');
    const owner = await this.resolveOwner();
    for (const resource of plan.resources) {
      if (resource.action === 'noop') continue;
      const repoName = owner ? `${owner}/${this.projectName}` : this.projectName;
      const result = await this.runGh(['repo', 'create', repoName, '--private', '--source', this.workspacePath, '--push'], { cwd: this.workspacePath });
      if (!result.success) throw new Error(`GitHub repository creation failed: ${result.stderr || result.stdout}`);
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
      if (!candidate) drift.push({ resourceId: resource.id, type: 'missing', detail: 'GitHub repository is absent from discovered state.' });
      else if (candidate.owner !== resource.owner) drift.push({ resourceId: resource.id, type: 'owner-mismatch', detail: `Expected owner ${resource.owner}, found ${candidate.owner}.` });
    }
    return drift;
  }
}
