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

export function repositoryFromRemoteUrl(remoteUrl: string) {
  const match = /(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  return match ? match[1] : '';
}

export class GitHubAdapter implements ProviderAdapter {
  readonly providerId = 'github';

  constructor(
    private owner: string,
    private projectName: string,
    private workspacePath: string,
    private runner: CommandRunner = defaultRunner,
    private branches: { integrationBranch?: string; productionBranch?: string } = {},
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
      await this.createDeclaredBranches(repoName);
    }
    return { providerId: this.providerId, idempotencyKey: plan.idempotencyKey, applied: true, state: await this.discover() };
  }

  // `repo create --push` publishes the feature branch alone, so the repository has no base for the
  // documented `feature/* -> dev -> main` flow and the first pull request cannot be opened at all.
  // Both branches start at the baseline commit: the feature under review must not already be on them.
  private async createDeclaredBranches(repoName: string) {
    const declared = [this.branches.productionBranch, this.branches.integrationBranch].filter((branch): branch is string => Boolean(branch));
    if (!declared.length) return;
    const baseline = await this.runner('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: this.workspacePath });
    const sha = baseline.stdout.trim().split('\n')[0];
    if (!baseline.success || !sha) throw new Error(`Unable to resolve the baseline commit for ${repoName}: ${baseline.stderr || baseline.stdout}`);
    for (const branch of declared) {
      const created = await this.runGh(['api', `repos/${repoName}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`], { cwd: this.workspacePath });
      if (!created.success && !`${created.stderr}${created.stdout}`.includes('Reference already exists')) {
        throw new Error(`Unable to create branch ${branch} in ${repoName}: ${created.stderr || created.stdout}`);
      }
    }
    if (!this.branches.productionBranch) return;
    const renamed = await this.runGh(['repo', 'edit', repoName, '--default-branch', this.branches.productionBranch], { cwd: this.workspacePath });
    if (!renamed.success) throw new Error(`Unable to set ${this.branches.productionBranch} as the default branch of ${repoName}: ${renamed.stderr || renamed.stdout}`);
  }

  // `repo create --push` is the only push in the platform and it happens once, so without this the
  // agent's commits reach GitHub only if a human runs `git push` by hand.
  async publishPullRequest(request: { branch: string; base: string; title: string; body: string; expectedRepository: string }): Promise<{ url: string; head: string }> {
    await this.ensureOrigin(request.expectedRepository);
    const pushed = await this.runner('git', ['push', '-u', 'origin', request.branch], { cwd: this.workspacePath });
    if (!pushed.success) throw new Error(`Unable to push ${request.branch} to ${request.expectedRepository}: ${pushed.stderr || pushed.stdout}`);
    const head = await this.runner('git', ['rev-parse', 'HEAD'], { cwd: this.workspacePath });
    if (!head.success || !head.stdout.trim()) throw new Error(`Unable to read the pushed commit of ${request.branch}: ${head.stderr || head.stdout}`);

    const created = await this.runGh(['pr', 'create', '--repo', request.expectedRepository, '--base', request.base, '--head', request.branch, '--title', request.title, '--body', request.body], { cwd: this.workspacePath });
    const url = this.readPullRequestUrl(created.stdout);
    if (created.success && url) return { url, head: head.stdout.trim() };
    // Re-running the step after a partial failure must not be blocked by the pull request the
    // previous attempt already opened.
    const existing = await this.runGh(['pr', 'view', request.branch, '--repo', request.expectedRepository, '--json', 'url', '--jq', '.url'], { cwd: this.workspacePath });
    const existingUrl = this.readPullRequestUrl(existing.stdout);
    if (existing.success && existingUrl) return { url: existingUrl, head: head.stdout.trim() };
    throw new Error(`Unable to open a pull request for ${request.branch}: ${created.stderr || created.stdout}`);
  }

  private readPullRequestUrl(output: string) {
    return output.split('\n').map(line => line.trim()).find(line => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(line));
  }

  private async ensureOrigin(expectedRepository: string) {
    const current = await this.runner('git', ['remote', 'get-url', 'origin'], { cwd: this.workspacePath });
    if (!current.success || !current.stdout.trim()) {
      const added = await this.runner('git', ['remote', 'add', 'origin', `https://github.com/${expectedRepository}.git`], { cwd: this.workspacePath });
      if (!added.success) throw new Error(`Unable to point origin at ${expectedRepository}: ${added.stderr || added.stdout}`);
      return;
    }
    const actual = repositoryFromRemoteUrl(current.stdout.trim());
    // Pushing an accepted delivery to a remote the platform did not create would publish the product
    // somewhere nobody recorded, and the pull request evidence would describe the wrong repository.
    if (actual !== expectedRepository) throw new Error(`Refusing to push: origin is ${current.stdout.trim()}, but the recorded repository is ${expectedRepository}.`);
  }

  async verify(expected: ProviderResourceSpec[]): Promise<ProviderVerification> {    const actual = await this.discover();
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
