import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner, CliResult } from '@agent-dev/provider-cli';
import { DeploymentComposer } from '../src/composer.js';
import { cleanupPreviewProjects } from '../src/cleanup.js';

function createMockRunner(responses: Record<string, CliResult>): CommandRunner {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) return result;
    }
    return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
  };
}

function createFullSuccessRunner(): CommandRunner {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    if (key.includes('vercel project add')) return { stdout: 'Created project', stderr: '', exitCode: 0, success: true };
    if (key.includes('vercel deploy')) return { stdout: JSON.stringify({ url: 'https://test-api-preview.vercel.app' }), stderr: '', exitCode: 0, success: true };
    if (key.includes('npm run build')) return { stdout: 'Build complete', stderr: '', exitCode: 0, success: true };
    if (key.includes('wrangler pages project create')) return { stdout: 'Created', stderr: '', exitCode: 0, success: true };
    if (key.includes('wrangler pages deploy')) return { stdout: 'Deployed: https://feature-x.test-project-web-feature-x.pages.dev', stderr: '', exitCode: 0, success: true };
    return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
  };
}

describe('DeploymentComposer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-dev-composer-'));
    await mkdir(join(tempDir, 'apps/api'), { recursive: true });
    await mkdir(join(tempDir, 'apps/web'), { recursive: true });
  });

  describe('plan()', () => {
    it('returns all steps in pending status without executing anything', async () => {
      const runner = createFullSuccessRunner();
      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      const steps = composer.plan();
      expect(steps).toHaveLength(7);
      expect(steps.every(s => s.status === 'pending')).toBe(true);
      expect(steps[0].id).toBe('deploy-vercel-preview');
      expect(steps[6].id).toBe('write-evidence');
    });

    it('provides correct CORS origin based on project and branch', () => {
      const runner = createFullSuccessRunner();
      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'my-app',
        previewBranch: 'pr-42',
      }, runner);

      expect(composer.corsOrigin).toBe('https://pr-42.my-app-web-pr-42.pages.dev');
    });

    it('provides deterministic idempotency key', () => {
      const runner = createFullSuccessRunner();
      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'my-app',
        previewBranch: 'pr-42',
      }, runner);

      expect(composer.idempotencyKey).toBe('preview:my-app:pr-42');
    });
  });

  describe('execute()', () => {
    it('fails before creating a Vercel project when neither a token nor a CLI session exists', async () => {
      vi.stubEnv('VERCEL_TOKEN', '');
      const calls: string[] = [];
      const runner: CommandRunner = async (command, args) => {
        calls.push(`${command} ${args.join(' ')}`);
        return { stdout: '', stderr: 'Not authenticated', exitCode: 1, success: false };
      };

      const composer = new DeploymentComposer({ workspacePath: tempDir, projectName: 'test-project', previewBranch: 'feature-x' }, runner);
      const result = await composer.execute();

      expect(result.status).toBe('failed');
      expect(result.steps[0].detail).toContain('set VERCEL_TOKEN or run `vercel login`');
      expect(result.cleanupRequired).toBeUndefined();
      expect(calls).toEqual(['vercel whoami --no-color']);
      vi.unstubAllEnvs();
    });

    it('disables deployment protection through `vercel api` when only a CLI session exists', async () => {
      vi.stubEnv('VERCEL_TOKEN', '');
      const mockFetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
        url.includes('.pages.dev') ? '<script>https://test-api-preview.vercel.app</script>' : JSON.stringify({ ok: true }),
        { headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' } },
      )));
      vi.stubGlobal('fetch', mockFetch);

      const calls: string[] = [];
      const base = createFullSuccessRunner();
      const runner: CommandRunner = async (command, args, options) => {
        calls.push(`${command} ${args.join(' ')}`);
        if (args[0] === 'whoami') return { stdout: 'test-user', stderr: '', exitCode: 0, success: true };
        if (args[0] === 'api') return { stdout: '', stderr: '', exitCode: 0, success: true };
        return base(command, args, options);
      };

      const composer = new DeploymentComposer({ workspacePath: tempDir, projectName: 'test-project', previewBranch: 'feature-x' }, runner);
      const result = await composer.execute();

      expect(result.status).toBe('completed');
      const apiCall = calls.find(call => call.startsWith('vercel api'));
      expect(apiCall).toContain('/v9/projects/test-project-api-feature-x');
      expect(apiCall).toContain('-X PATCH');
      expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('api.vercel.com'), expect.anything());

      const body = await readFile(join(tempDir, '.agent-dev/vercel-deployment-protection.json'), 'utf8');
      expect(JSON.parse(body)).toEqual({ ssoProtection: null, passwordProtection: null });

      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('records the Cloudflare Pages URL emitted by Wrangler', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(
        url.includes('.pages.dev') ? '<script>https://test-api-preview.vercel.app</script>' : JSON.stringify({ ok: true }),
        { headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' } },
      )));
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VERCEL_TOKEN', 'test-token');
      const composer = new DeploymentComposer({ workspacePath: tempDir, projectName: 'test-project', previewBranch: 'feature-x' }, createFullSuccessRunner());
      const result = await composer.execute();
      expect(result.status).toBe('completed');
      expect(result.pagesUrl).toBe('https://feature-x.test-project-web-feature-x.pages.dev');
      expect(result.pagesUrlSource).toBe('cli-output');
      const evidence = await readFile(join(tempDir, '.agent-dev/previews/test-project-feature-x.json'), 'utf8');
      expect(JSON.parse(evidence).pagesUrlSource).toBe('cli-output');
      vi.unstubAllGlobals();
    });

    it('fails gracefully when vercel deploy fails', async () => {
      const runner = createMockRunner({
        'vercel project add': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
        'vercel deploy': { stdout: '', stderr: 'Insufficient permissions', exitCode: 1, success: false },
      });

      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      const result = await composer.execute();
      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].detail).toContain('Vercel preview deployment failed');
      expect(result.steps[1].status).toBe('pending');
      expect(result.cleanupRequired?.vercel).toBe('test-project-api-feature-x');
    });

    it('handles already-existing project gracefully', async () => {
      // Mock fetch to respond to Vercel API PATCH and health checks
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' },
      }));
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VERCEL_TOKEN', 'test-token');

      const runner = createMockRunner({
        'vercel project add': { stdout: '', stderr: 'Project already exists', exitCode: 1, success: false },
        'vercel deploy': { stdout: JSON.stringify({ url: 'https://test.vercel.app' }), stderr: '', exitCode: 0, success: true },
        'npm run build': { stdout: 'Built', stderr: '', exitCode: 0, success: true },
        'wrangler pages project create': { stdout: '', stderr: 'already exists', exitCode: 1, success: false },
        'wrangler pages deploy': { stdout: 'Deployed', stderr: '', exitCode: 0, success: true },
      });

      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      const result = await composer.execute();
      // Should not fail due to "already exists" errors
      expect(result.steps[0].status).toBe('completed');

      vi.unstubAllGlobals();
    });

    it('does not suppress Wrangler logs when creating the Pages project', async () => {
      // Real Wrangler prints "already exists" only when logging is enabled, so suppressing it here
      // silently broke re-runs: the idempotency check had no message left to match.
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' },
      }));
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VERCEL_TOKEN', 'test-token');

      let createEnv: Record<string, string> | undefined;
      const runner: CommandRunner = async (command, args, options) => {
        const key = `${command} ${args.join(' ')}`;
        if (key.includes('wrangler pages project create')) {
          createEnv = options?.env;
          return { stdout: '', stderr: '', exitCode: 1, success: false };
        }
        if (key.includes('vercel project add')) return { stdout: 'Created', stderr: '', exitCode: 0, success: true };
        if (key.includes('vercel deploy')) return { stdout: JSON.stringify({ url: 'https://test.vercel.app' }), stderr: '', exitCode: 0, success: true };
        if (key.includes('npm run build')) return { stdout: 'Built', stderr: '', exitCode: 0, success: true };
        return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
      };

      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      await composer.execute();
      expect(createEnv?.WRANGLER_LOG).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('parses deployment URL from JSON output', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' },
      }));
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VERCEL_TOKEN', 'test-token');

      const runner = createMockRunner({
        'vercel project add': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
        'vercel deploy': { stdout: '{"url":"https://my-api.vercel.app","readyState":"READY"}', stderr: '', exitCode: 0, success: true },
        'npm run build': { stdout: 'OK', stderr: '', exitCode: 0, success: true },
        'wrangler pages project create': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
        'wrangler pages deploy': { stdout: 'Deployed', stderr: '', exitCode: 0, success: true },
      });

      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      const result = await composer.execute();
      const vercelStep = result.steps.find(s => s.id === 'deploy-vercel-preview');
      expect(vercelStep?.status).toBe('completed');
      expect(vercelStep?.detail).toContain('https://my-api.vercel.app');

      vi.unstubAllGlobals();
    });

    it('parses deployment URL from text output fallback', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://feature-x.test-project-web-feature-x.pages.dev' },
      }));
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('VERCEL_TOKEN', 'test-token');

      const runner = createMockRunner({
        'vercel project add': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
        'vercel deploy': { stdout: 'Deploying...\nProduction: https://fallback-api.vercel.app\nDone!', stderr: '', exitCode: 0, success: true },
        'npm run build': { stdout: 'OK', stderr: '', exitCode: 0, success: true },
        'wrangler pages project create': { stdout: 'Created', stderr: '', exitCode: 0, success: true },
        'wrangler pages deploy': { stdout: 'Deployed', stderr: '', exitCode: 0, success: true },
      });

      const composer = new DeploymentComposer({
        workspacePath: tempDir,
        projectName: 'test-project',
        previewBranch: 'feature-x',
      }, runner);

      const result = await composer.execute();
      const vercelStep = result.steps.find(s => s.id === 'deploy-vercel-preview');
      expect(vercelStep?.status).toBe('completed');
      expect(vercelStep?.detail).toContain('https://fallback-api.vercel.app');

      vi.unstubAllGlobals();
    });
  });
});

describe('cleanupPreviewProjects', () => {
  it('reports success when both deletions succeed', async () => {
    const runner = createMockRunner({
      'wrangler pages project delete': { stdout: 'Deleted', stderr: '', exitCode: 0, success: true },
      'vercel project rm': { stdout: 'Deleted', stderr: '', exitCode: 0, success: true },
    });

    const result = await cleanupPreviewProjects(runner, {
      vercelProject: 'test-vercel',
      cloudflareProject: 'test-cf',
      workspacePath: '/tmp/workspace',
    });

    expect(result.vercel).toBe(true);
    expect(result.cloudflare).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports partial failure when one deletion fails', async () => {
    const runner = createMockRunner({
      'wrangler pages project delete': { stdout: '', stderr: 'Permission denied', exitCode: 1, success: false },
      'vercel project rm': { stdout: 'Deleted', stderr: '', exitCode: 0, success: true },
    });

    const result = await cleanupPreviewProjects(runner, {
      vercelProject: 'test-vercel',
      cloudflareProject: 'test-cf',
      workspacePath: '/tmp/workspace',
    });

    expect(result.vercel).toBe(true);
    expect(result.cloudflare).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].provider).toBe('cloudflare');
  });

  it('skips deletion when project name is not provided', async () => {
    const runner = createMockRunner({});
    const result = await cleanupPreviewProjects(runner, {
      workspacePath: '/tmp/workspace',
    });

    expect(result.vercel).toBe(true);
    expect(result.cloudflare).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
