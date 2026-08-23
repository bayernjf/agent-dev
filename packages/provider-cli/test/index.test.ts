import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubAdapter, VercelAdapter, CloudflareAdapter, ManualProviderAdapter, RealProviderRegistry, getCredentialMeta, loadCredentials, saveCredentials, writeProjectResources, loadProjectResources, generateEnvFile, type CommandRunner, type CliResult } from '../src/index.js';

const mockRunner = (responses: Record<string, CliResult>): CommandRunner => {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) return result;
    }
    return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
  };
};

const approval = { id: 'approval-1', status: 'approved' as const, approvedAt: '2026-08-08T00:00:00.000Z' };
const resources = [{ id: 'github-repository', kind: 'repository', owner: 'bayernjf' }];

describe('GitHubAdapter', () => {
  it('discovers existing repo and plans noop', async () => {
    const runner = mockRunner({
      'gh api user --jq .login': { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true },
      'gh repo view bayernjf/test-project --json': { stdout: JSON.stringify({ name: 'test-project', owner: { login: 'bayernjf' }, isPrivate: true }), stderr: '', exitCode: 0, success: true },
    });
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const state = await adapter.discover();
    expect(state.resources).toHaveLength(1);
    expect(state.resources[0].owner).toBe('bayernjf');
    const plan = await adapter.plan(resources);
    expect(plan.resources[0].action).toBe('noop');
  });

  it('plans create when repo does not exist', async () => {
    const runner = mockRunner({
      'gh api user --jq .login': { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true },
      'gh repo view': { stdout: '', stderr: 'repository not found', exitCode: 1, success: false },
    });
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(resources);
    expect(plan.resources[0].action).toBe('create');
    expect(plan.noExternalChanges).toBe(true);
  });

  it('creates the declared integration and production branches so a pull request has a base', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(' ')}`;
      calls.push(key);
      if (key.includes('gh api user')) return { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true };
      if (key.includes('git rev-list')) return { stdout: 'a1b2c3d\n', stderr: '', exitCode: 0, success: true };
      if (key.includes('gh repo create') || key.includes('gh api repos/') || key.includes('gh repo edit')) return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      if (key.includes('gh repo view')) return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
      return { stdout: '', stderr: '', exitCode: 1, success: false };
    };
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner, { integrationBranch: 'dev', productionBranch: 'main' });
    await adapter.apply(await adapter.plan(resources), approval);

    // The feature branch is the only ref `repo create --push` publishes, and both bases have to
    // start at the baseline commit rather than at the feature under review.
    expect(calls).toContain('gh api repos/bayernjf/test-project/git/refs -f ref=refs/heads/dev -f sha=a1b2c3d');
    expect(calls).toContain('gh api repos/bayernjf/test-project/git/refs -f ref=refs/heads/main -f sha=a1b2c3d');
    expect(calls).toContain('gh repo edit bayernjf/test-project --default-branch main');
  });

  it('backfills the declared branches on a repository that already exists', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(' ')}`;
      calls.push(key);
      if (key.includes('gh api user')) return { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true };
      if (key.includes('gh repo view')) return { stdout: JSON.stringify({ name: 'test-project', owner: { login: 'bayernjf' }, isPrivate: true }), stderr: '', exitCode: 0, success: true };
      if (key.includes('git rev-list')) return { stdout: 'a1b2c3d\n', stderr: '', exitCode: 0, success: true };
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    };
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner, { integrationBranch: 'dev', productionBranch: 'main' });
    const plan = await adapter.plan(resources);
    expect(plan.resources[0].action).toBe('noop');
    await adapter.apply(plan, approval);

    // A repository provisioned before the platform declared these branches would otherwise never
    // gain them, and its first pull request would have no base.
    expect(calls).not.toContain('gh repo create bayernjf/test-project --private --source /tmp/workspace --push');
    expect(calls).toContain('gh api repos/bayernjf/test-project/git/refs -f ref=refs/heads/dev -f sha=a1b2c3d');
  });

  it('pushes the branch and opens a pull request', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(' ')}`;
      calls.push(key);
      if (key.includes('git remote get-url')) return { stdout: 'https://github.com/bayernjf/test-project.git\n', stderr: '', exitCode: 0, success: true };
      if (key.includes('git push')) return { stdout: '', stderr: '', exitCode: 0, success: true };
      if (key.includes('git rev-parse')) return { stdout: 'deadbee\n', stderr: '', exitCode: 0, success: true };
      if (key.includes('gh pr create')) return { stdout: 'https://github.com/bayernjf/test-project/pull/1\n', stderr: '', exitCode: 0, success: true };
      return { stdout: '', stderr: '', exitCode: 1, success: false };
    };
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const published = await adapter.publishPullRequest({ branch: 'feature/x', base: 'dev', title: 'Feature', body: 'Evidence', expectedRepository: 'bayernjf/test-project' });
    expect(published).toEqual({ url: 'https://github.com/bayernjf/test-project/pull/1', head: 'deadbee' });
    expect(calls).toContain('git push -u origin feature/x');
  });

  it('refuses to push when origin is not the recorded repository', async () => {
    const runner = mockRunner({ 'git remote get-url': { stdout: 'https://github.com/someone-else/other.git', stderr: '', exitCode: 0, success: true } });
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    // Pushing an accepted delivery to an unrecorded remote would publish the product somewhere the
    // evidence does not describe.
    await expect(adapter.publishPullRequest({ branch: 'feature/x', base: 'dev', title: 'Feature', body: 'Evidence', expectedRepository: 'bayernjf/test-project' })).rejects.toThrow(/Refusing to push/);
  });

  it('reuses the pull request a previous attempt already opened', async () => {
    const runner = mockRunner({
      'git remote get-url': { stdout: 'https://github.com/bayernjf/test-project.git', stderr: '', exitCode: 0, success: true },
      'git push': { stdout: '', stderr: '', exitCode: 0, success: true },
      'git rev-parse': { stdout: 'deadbee', stderr: '', exitCode: 0, success: true },
      'gh pr create': { stdout: '', stderr: 'a pull request for branch feature/x already exists', exitCode: 1, success: false },
      'gh pr view': { stdout: 'https://github.com/bayernjf/test-project/pull/7', stderr: '', exitCode: 0, success: true },
    });
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const published = await adapter.publishPullRequest({ branch: 'feature/x', base: 'dev', title: 'Feature', body: 'Evidence', expectedRepository: 'bayernjf/test-project' });
    expect(published.url).toBe('https://github.com/bayernjf/test-project/pull/7');
  });

  it('creates repo on apply', async () => {
    let createCalled = false;
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(' ')}`;
      if (key.includes('gh api user')) return { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true };
      if (key.includes('gh repo create')) { createCalled = true; return { stdout: 'Created', stderr: '', exitCode: 0, success: true }; }
      if (key.includes('gh repo view')) return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
      return { stdout: '', stderr: '', exitCode: 1, success: false };
    };
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(resources);
    const result = await adapter.apply(plan, approval);
    expect(createCalled).toBe(true);
    expect(result.applied).toBe(true);
  });

  it('uses the saved GitHub token for owner and repository discovery', async () => {
    const previous = process.env.AGENT_DEV_CREDENTIALS_PATH;
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-github-token-'));
    process.env.AGENT_DEV_CREDENTIALS_PATH = join(directory, 'credentials.txt');
    saveCredentials({ GITHUB_TOKEN: 'fixture-token' });
    const receivedTokens: Array<string | undefined> = [];
    const runner: CommandRunner = async (_command, args, options) => {
      receivedTokens.push(options?.env?.GITHUB_TOKEN);
      if (args[0] === 'api') return { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true };
      return { stdout: JSON.stringify({ id: 'R_1', name: 'test-project', owner: { login: 'bayernjf' }, isPrivate: true, url: 'https://github.com/bayernjf/test-project' }), stderr: '', exitCode: 0, success: true };
    };
    try {
      const state = await new GitHubAdapter('', 'test-project', '/tmp/workspace', runner).discover();
      expect(receivedTokens).toEqual(['fixture-token', 'fixture-token']);
      expect(state.resources[0]).toMatchObject({ externalId: 'R_1', url: 'https://github.com/bayernjf/test-project' });
    } finally {
      if (previous === undefined) delete process.env.AGENT_DEV_CREDENTIALS_PATH;
      else process.env.AGENT_DEV_CREDENTIALS_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects owner drift', async () => {
    const runner = mockRunner({
      'gh api user --jq .login': { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true },
      'gh repo view': { stdout: JSON.stringify({ name: 'test-project', owner: { login: 'other-user' }, isPrivate: true }), stderr: '', exitCode: 0, success: true },
    });
    const adapter = new GitHubAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const drift = await adapter.detectDrift(resources);
    expect(drift).toHaveLength(1);
    expect(drift[0].type).toBe('owner-mismatch');
  });
});

describe('VercelAdapter', () => {
  const vercelResources = [{ id: 'vercel-api', kind: 'functions-project', owner: 'bayernjf' }];

  it('plans create when project not found', async () => {
    const runner = mockRunner({
      'vercel project ls': { stdout: 'other-project\nsome-other', stderr: '', exitCode: 0, success: true },
    });
    const adapter = new VercelAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(vercelResources);
    expect(plan.resources[0].action).toBe('create');
  });

  it('plans noop when project exists', async () => {
    const runner = mockRunner({
      'vercel project ls': { stdout: 'test-project\nother-project', stderr: '', exitCode: 0, success: true },
    });
    const adapter = new VercelAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(vercelResources);
    expect(plan.resources[0].action).toBe('noop');
  });

  it('keeps Vercel project facts returned by the CLI', async () => {
    const runner = mockRunner({
      'vercel project ls': { stdout: 'test-project', stderr: '', exitCode: 0, success: true },
      'vercel project inspect': { stdout: JSON.stringify({ id: 'prj_123', name: 'test-project', accountId: 'team_123', targets: { production: { url: 'https://test-project.vercel.app' } } }), stderr: '', exitCode: 0, success: true },
    });
    const state = await new VercelAdapter('bayernjf', 'test-project', '/tmp/workspace', runner).discover();
    expect(state.resources[0]).toMatchObject({ externalId: 'prj_123', url: 'https://test-project.vercel.app', metadata: { orgId: 'team_123' } });
  });
});

describe('CloudflareAdapter', () => {
  const cfResources = [{ id: 'cloudflare-pages', kind: 'pages-project', owner: 'bayernjf' }];

  it('plans create when project not found', async () => {
    const runner = mockRunner({
      'wrangler pages project list': { stdout: 'other-project', stderr: '', exitCode: 0, success: true },
    });
    const adapter = new CloudflareAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(cfResources);
    expect(plan.resources[0].action).toBe('create');
  });

  it('plans noop when project exists', async () => {
    const runner = mockRunner({
      'wrangler pages project list': { stdout: 'test-project\nother', stderr: '', exitCode: 0, success: true },
    });
    const adapter = new CloudflareAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const plan = await adapter.plan(cfResources);
    expect(plan.resources[0].action).toBe('noop');
  });

  it('keeps Cloudflare Pages facts returned by Wrangler', async () => {
    const runner = mockRunner({
      'wrangler pages project list --json': { stdout: JSON.stringify([{ id: 'cf_123', name: 'test-project', subdomain: 'test-project.pages.dev', production_branch: 'main', account_id: 'account_123', created_on: '2026-08-09T00:00:00.000Z' }]), stderr: '', exitCode: 0, success: true },
      'wrangler pages project list': { stdout: 'test-project', stderr: '', exitCode: 0, success: true },
    });
    const state = await new CloudflareAdapter('bayernjf', 'test-project', '/tmp/workspace', runner).discover();
    expect(state.resources[0]).toMatchObject({ externalId: 'cf_123', url: 'https://test-project.pages.dev', metadata: { accountId: 'account_123', productionBranch: 'main' } });
  });

  it('creates the project during onboarding without deploying the frontend', async () => {
    // The frontend `dist` does not exist at provider-apply time, so a deploy here would fail with
    // ENOENT. Deployment belongs to the Preview/Release orchestration.
    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args.includes('list')) return { stdout: 'other', stderr: '', exitCode: 0, success: true };
      if (args.includes('create')) return { stdout: 'Created', stderr: '', exitCode: 0, success: true };
      if (args.includes('deploy')) return { stdout: 'Deployed', stderr: '', exitCode: 0, success: true };
      return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
    };
    const adapter = new CloudflareAdapter('bayernjf', 'test-project', '/tmp/workspace', runner);
    const result = await adapter.apply({ providerId: 'cloudflare', idempotencyKey: 'cloudflare:cloudflare-pages:create', noExternalChanges: true, resources: [{ spec: { id: 'cloudflare-pages', kind: 'pages-project', owner: 'bayernjf' }, action: 'create', reason: 'does not exist' }] }, approval);
    expect(result.applied).toBe(true);
    expect(calls.some(call => call.includes('pages project create'))).toBe(true);
    expect(calls.some(call => call.includes('pages deploy'))).toBe(false);
  });
});

describe('ManualProviderAdapter', () => {
  const manualResources = [{ id: 'supabase-project', kind: 'database-auth-project', owner: 'my-org' }];

  it('always returns noop plan', async () => {
    const adapter = new ManualProviderAdapter('supabase', 'Supabase is manual.');
    const plan = await adapter.plan(manualResources);
    expect(plan.resources[0].action).toBe('noop');
    expect(plan.resources[0].reason).toBe('Supabase is manual.');
  });

  it('verify returns not verified with missing', async () => {
    const adapter = new ManualProviderAdapter('supabase', 'Supabase is manual.');
    const verification = await adapter.verify(manualResources);
    expect(verification.verified).toBe(false);
    expect(verification.missing).toEqual(['supabase-project']);
  });

  it('detectDrift reports all as missing', async () => {
    const adapter = new ManualProviderAdapter('supabase', 'Supabase is manual.');
    const drift = await adapter.detectDrift(manualResources);
    expect(drift).toHaveLength(1);
    expect(drift[0].type).toBe('missing');
  });
});

describe('RealProviderRegistry', () => {
  it('routes to correct adapters and resolves context', async () => {
    const runner = mockRunner({
      'gh auth status': { stdout: 'Logged in', stderr: '', exitCode: 0, success: true },
      'gh api user': { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true },
      'gh repo view': { stdout: '', stderr: 'not found', exitCode: 1, success: false },
      'gh repo create': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
      'vercel whoami': { stdout: 'bayernjf', stderr: '', exitCode: 0, success: true },
      'vercel project ls': { stdout: 'other', stderr: '', exitCode: 0, success: true },
      'vercel --prod': { stdout: 'Deployed', stderr: '', exitCode: 0, success: true },
      'wrangler whoami': { stdout: 'Authenticated', stderr: '', exitCode: 0, success: true },
      'wrangler pages project list': { stdout: 'other', stderr: '', exitCode: 0, success: true },
      'wrangler pages project create': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
      'wrangler pages deploy': { stdout: 'Deployed', stderr: '', exitCode: 0, success: true },
    });
    const registry = new RealProviderRegistry({
      resolveContext: async () => ({ workspacePath: '/tmp/workspace', projectName: 'test-project' }),
      runner,
    });
    const specs = {
      github: [{ id: 'github-repository', kind: 'repository', owner: 'bayernjf' }],
      vercel: [{ id: 'vercel-api', kind: 'functions-project', owner: 'bayernjf' }],
      cloudflare: [{ id: 'cloudflare-pages', kind: 'pages-project', owner: 'bayernjf' }],
      supabase: [{ id: 'supabase-project', kind: 'database-auth-project', owner: 'my-org' }],
    };
    const plans = await registry.plan('proj-1', specs);
    expect(plans).toHaveLength(4);
    expect(plans.find(p => p.providerId === 'github')!.resources[0].action).toBe('create');
    expect(plans.find(p => p.providerId === 'supabase')!.resources[0].action).toBe('noop');
    expect(plans.find(p => p.providerId === 'supabase')!.resources[0].reason).toContain('irreversible');
  });

  it('degrades to manual when CLI is not authenticated', async () => {
    const runner = mockRunner({
      'gh auth status': { stdout: '', stderr: 'not logged in', exitCode: 1, success: false },
      'vercel whoami': { stdout: '', stderr: 'not logged in', exitCode: 1, success: false },
      'wrangler whoami': { stdout: '', stderr: 'not logged in', exitCode: 1, success: false },
    });
    const registry = new RealProviderRegistry({
      resolveContext: async () => ({ workspacePath: '/tmp/workspace', projectName: 'test-project' }),
      runner,
    });
    const specs = {
      github: [{ id: 'github-repository', kind: 'repository', owner: 'bayernjf' }],
      vercel: [{ id: 'vercel-api', kind: 'functions-project', owner: 'bayernjf' }],
      cloudflare: [{ id: 'cloudflare-pages', kind: 'pages-project', owner: 'bayernjf' }],
      supabase: [{ id: 'supabase-project', kind: 'database-auth-project', owner: 'my-org' }],
    };
    const plans = await registry.plan('proj-1', specs);
    expect(plans.every(p => p.resources[0].action === 'noop')).toBe(true);
    expect(plans.find(p => p.providerId === 'github')!.resources[0].reason).toContain('not authenticated');
    expect(plans.find(p => p.providerId === 'cloudflare')!.resources[0].reason).toContain('wrangler');
  });

  it('rechecks provider availability after credentials are updated', async () => {
    let authenticated = false;
    const registry = new RealProviderRegistry({
      resolveContext: async () => ({ workspacePath: '/tmp/workspace', projectName: 'test-project' }),
      runner: async (command, args) => {
        if (command === 'gh' && args[0] === 'auth') return { stdout: authenticated ? 'Logged in' : '', stderr: authenticated ? '' : 'not logged in', exitCode: authenticated ? 0 : 1, success: authenticated };
        if (command === 'gh' && args[0] === 'repo') return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
        return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
      },
    });
    const specs = { github: [{ id: 'github-repository', kind: 'repository', owner: 'bayernjf' }] };
    expect((await registry.plan('proj-1', specs))[0].resources[0].action).toBe('noop');
    authenticated = true;
    registry.invalidateCredentials();
    expect((await registry.plan('proj-1', specs))[0].resources[0].action).toBe('create');
  });

  it('throws when context cannot be resolved', async () => {
    const registry = new RealProviderRegistry({
      resolveContext: async () => null,
    });
    await expect(registry.plan('proj-1', {})).rejects.toThrow('No workspace context');
  });
});

describe('local credential and resource files', () => {
  it('writes credentials with metadata without exposing values in metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-credentials-'));
    const previous = process.env.AGENT_DEV_CREDENTIALS_PATH;
    process.env.AGENT_DEV_CREDENTIALS_PATH = join(directory, 'credentials.txt');
    try {
      saveCredentials({ GITHUB_TOKEN: 'fixture-secret', OPENAI_API_KEY: 'fixture-key' });
      expect(loadCredentials()).toEqual({ GITHUB_TOKEN: 'fixture-secret', OPENAI_API_KEY: 'fixture-key' });
      expect(getCredentialMeta()).toMatchObject({ version: 1, keys: ['GITHUB_TOKEN', 'OPENAI_API_KEY'] });
      await expect(readFile(join(directory, 'credentials.txt.meta.json'), 'utf8')).resolves.not.toContain('fixture-secret');
    } finally {
      if (previous === undefined) delete process.env.AGENT_DEV_CREDENTIALS_PATH;
      else process.env.AGENT_DEV_CREDENTIALS_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists project resources and generates an application env file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-resources-'));
    try {
      writeProjectResources(directory, 'demo', 'project-1', 1, 'vercel', { projectId: 'prj_demo', productionUrl: 'https://demo.example' });
      const resources = loadProjectResources(directory);
      expect(resources?.providers.vercel).toMatchObject({ projectId: 'prj_demo' });
      generateEnvFile(directory, { OPENAI_API_KEY: 'fixture-key' }, resources, 'demo');
      await expect(readFile(join(directory, '.env'), 'utf8')).resolves.toContain('OPENAI_API_KEY=fixture-key');
      await expect(readFile(join(directory, '.env'), 'utf8')).resolves.toContain('VERCEL_PROJECT_ID=prj_demo');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
