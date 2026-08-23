import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner, CliResult } from '@agent-dev/provider-cli';
import { ReleaseComposer } from '../src/release.js';

const PROJECT = 'receipt-desk';
const CORS_ORIGIN = `https://${PROJECT}-web.pages.dev`;
const API_URL = 'https://receipt-desk-api.vercel.app';
// What `vercel deploy --prod` reports: the immutable deployment URL, which Deployment Protection
// guards. The public production address is the alias.
const DEPLOYMENT_URL = 'https://receipt-desk-api-h88ixdrws-team.vercel.app';

function successRunner(overrides: Record<string, CliResult> = {}): CommandRunner {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    for (const [pattern, result] of Object.entries(overrides)) {
      if (key.includes(pattern)) return result;
    }
    if (key.includes('vercel whoami')) return { stdout: 'test-user', stderr: '', exitCode: 0, success: true };
    if (key.includes('vercel project add')) return { stdout: 'Created', stderr: '', exitCode: 0, success: true };
    if (key.includes('vercel deploy')) return { stdout: JSON.stringify({ url: DEPLOYMENT_URL }), stderr: '', exitCode: 0, success: true };
    if (key.includes('vercel inspect')) return { stdout: JSON.stringify({ url: DEPLOYMENT_URL, aliases: ['receipt-desk-api-team.vercel.app', 'receipt-desk-api.vercel.app'] }), stderr: '', exitCode: 0, success: true };
    if (key.includes('npm run quality')) return { stdout: 'quality ok', stderr: '', exitCode: 0, success: true };
    if (key.includes('npm run build')) return { stdout: 'built', stderr: '', exitCode: 0, success: true };
    if (key.includes('wrangler pages project create')) return { stdout: 'Created', stderr: '', exitCode: 0, success: true };
    if (key.includes('wrangler pages deploy')) return { stdout: 'Deployed: https://abc123.receipt-desk-web.pages.dev', stderr: '', exitCode: 0, success: true };
    return { stdout: '', stderr: 'not found', exitCode: 1, success: false };
  };
}

function stubProductionFetch() {
  const pageSource = `<script>const api="${API_URL}"</script>`;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    url.includes('.pages.dev') ? pageSource : JSON.stringify({ ok: true }),
    { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': CORS_ORIGIN } },
  )));
  return pageSource;
}

describe('ReleaseComposer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-dev-release-'));
    await mkdir(join(tempDir, 'apps/api'), { recursive: true });
    await mkdir(join(tempDir, 'apps/web'), { recursive: true });
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('plans the ordering the architecture requires, quality gate first', () => {
    const composer = new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, successRunner());
    expect(composer.plan().map(step => step.id)).toEqual([
      'verify-release-quality',
      'deploy-api-production',
      'verify-api-production',
      'build-web-production',
      'deploy-web-production',
      'verify-production-smoke',
      'write-release-evidence',
    ]);
    expect(composer.plan().every(step => step.status === 'pending')).toBe(true);
    expect(composer.corsOrigin).toBe(CORS_ORIGIN);
    expect(composer.idempotencyKey).toBe('release:receipt-desk:production');
  });

  it('deploys production project names without a branch suffix and never touches deployment protection', async () => {
    stubProductionFetch();
    const calls: string[] = [];
    const base = successRunner();
    const runner: CommandRunner = async (command, args, options) => {
      calls.push(`${command} ${args.join(' ')}`);
      return base(command, args, options);
    };

    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, runner).execute();
    expect(result.status).toBe('completed');
    expect(calls.some(call => call.includes('vercel project add receipt-desk-api '))).toBe(true);
    expect(calls.some(call => call.includes('wrangler pages project create receipt-desk-web'))).toBe(true);
    expect(calls.some(call => call.includes('--branch main'))).toBe(true);
    expect(calls.some(call => call.includes('--prod'))).toBe(true);
    // Preview disables SSO/password protection because previews are disposable. Production must
    // keep whatever protection the account configured, so no `vercel api` PATCH may be issued.
    expect(calls.some(call => call.startsWith('vercel api'))).toBe(false);
    // Only the project name matters here: Vercel's own deployment URL carries a hash suffix.
    expect(calls.every(call => !call.includes('--project receipt-desk-api-'))).toBe(true);
    expect(calls.every(call => !call.includes('vercel project add receipt-desk-api-'))).toBe(true);
  });

  it('verifies and ships the production alias, not the protected deployment URL', async () => {
    stubProductionFetch();
    const calls: string[] = [];
    const base = successRunner();
    const runner: CommandRunner = async (command, args, options) => {
      calls.push(`${command} ${args.join(' ')}`);
      return base(command, args, options);
    };

    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, runner).execute();
    expect(result.status).toBe('completed');
    expect(calls.some(call => call.includes(`vercel inspect ${DEPLOYMENT_URL}`))).toBe(true);
    // Deployment Protection answers the deployment URL with an SSO redirect, so verifying it reports
    // a healthy API as broken and the frontend would be built against an address users cannot reach.
    expect(result.apiBaseUrl).toBe(API_URL);
    expect(result.observations?.apiHealth.url).toBe(`${API_URL}/api/health`);
    expect(await readFile(join(tempDir, 'apps/web/.env.production'), 'utf8')).toBe(`VITE_API_BASE_URL=${API_URL}\n`);
  });

  it('fails the release when the production deployment has no alias to serve', async () => {
    stubProductionFetch();
    const runner = successRunner({ 'vercel inspect': { stdout: JSON.stringify({ url: DEPLOYMENT_URL, aliases: [] }), stderr: '', exitCode: 0, success: true } });
    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, runner).execute();
    expect(result.status).toBe('failed');
    const failed = result.steps.find(step => step.status === 'failed');
    expect(failed?.id).toBe('deploy-api-production');
    expect(failed?.detail).toContain('no alias');
  });

  it('records observed values as release evidence rather than verdict constants', async () => {
    const pageSource = stubProductionFetch();
    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, successRunner()).execute();
    expect(result.status).toBe('completed');

    const evidence = JSON.parse(await readFile(join(tempDir, '.agent-dev/releases/receipt-desk-production.json'), 'utf8'));
    expect(evidence.observations).toEqual({
      releaseQuality: { command: 'npm run quality', exitCode: 0 },
      apiHealth: { url: `${API_URL}/api/health`, httpStatus: 200, contentType: 'application/json; charset=utf-8', observedCorsHeader: CORS_ORIGIN },
      webPage: { url: CORS_ORIGIN, httpStatus: 200, sourceBytes: Buffer.byteLength(pageSource, 'utf8'), matchedApiBaseUrl: API_URL },
      productionSmoke: { apiHealthUrl: `${API_URL}/api/health`, apiHttpStatus: 200, observedCorsHeader: CORS_ORIGIN },
    });
    expect(JSON.stringify(evidence)).not.toContain('"passed"');
    expect(evidence.webUrl).toBe(CORS_ORIGIN);
  });

  it('stops at the quality gate and never deploys when the gate fails', async () => {
    stubProductionFetch();
    const calls: string[] = [];
    const base = successRunner({ 'npm run quality': { stdout: '', stderr: 'tsc failed', exitCode: 1, success: false } });
    const runner: CommandRunner = async (command, args, options) => {
      calls.push(`${command} ${args.join(' ')}`);
      return base(command, args, options);
    };

    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, runner).execute();
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({ id: 'verify-release-quality', status: 'failed' });
    expect(result.steps[0].detail).toContain('tsc failed');
    expect(result.steps.slice(1).every(step => step.status === 'pending')).toBe(true);
    expect(calls.some(call => call.includes('vercel deploy'))).toBe(false);
    expect(result.observations).toBeUndefined();
    await expect(readFile(join(tempDir, '.agent-dev/releases/receipt-desk-production.json'), 'utf8')).rejects.toThrow();
  });

  it('fails the release when production CORS does not match the production origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://receipt-desk-web-feature-x.pages.dev' },
    })));

    const result = await new ReleaseComposer({ workspacePath: tempDir, projectName: PROJECT }, successRunner()).execute();
    expect(result.status).toBe('failed');
    const failed = result.steps.find(step => step.status === 'failed');
    expect(failed?.id).toBe('verify-api-production');
    expect(failed?.detail).toContain(CORS_ORIGIN);
    expect(failed?.startedAt).toBeTruthy();
    expect(failed?.completedAt).toBeTruthy();
  });
});
