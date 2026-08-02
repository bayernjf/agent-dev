import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeDir = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const runIdIndex = process.argv.indexOf('--run-id');
const runId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : null;
const wrangler = join(spikeDir, '../platform-preflight/node_modules/.bin/wrangler');

assert.match(runId || '', /^[a-z0-9-]{6,20}$/, 'provide --run-id with 6-20 lowercase letters, digits, or hyphens');

const vercelProject = `agent-dev-api-${runId}`;
const cloudflareProject = `agent-dev-web-${runId}`;
const branch = 'spike';
const pageOrigin = `https://${branch}.${cloudflareProject}.pages.dev`;

const plan = {
  mode: apply ? 'apply' : 'plan',
  resources: {
    vercelProject,
    cloudflareProject,
    cloudflareBranch: branch,
  },
  sequence: [
    'configure the disposable Vercel project for public preview access',
    'deploy Vercel API preview with exact expected Pages branch origin',
    'verify API health and exact Access-Control-Allow-Origin',
    'inject Vercel preview URL into frontend build',
    'create and deploy Cloudflare Pages preview branch',
    'verify page and API jointly',
    'delete Cloudflare Pages and Vercel spike projects',
  ],
};

function commandEnvironment() {
  return {
    ...process.env,
    NO_COLOR: '1',
    VERCEL_TELEMETRY_DISABLED: '1',
    WRANGLER_LOG: 'none',
  };
}

function sanitizeDiagnostic(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/\b(?:sk-[A-Za-z0-9_*.-]{4,}|ghp_[A-Za-z0-9_*.-]{4,}|github_pat_[A-Za-z0-9_*.-]{4,})/g, '[REDACTED]')
    .trim()
    .slice(-1_200);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: commandEnvironment(),
    timeout: 300_000,
    ...options,
  });
  if (result.status !== 0) {
    const diagnostic = sanitizeDiagnostic(result.stderr || result.stdout);
    throw new Error(`${command} failed with exit code ${result.status}: ${diagnostic || 'no diagnostic'}`);
  }
  return result.stdout.trim();
}

function deploymentUrl(output) {
  try {
    const parsed = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    const value = parsed.url || parsed.deployment?.url;
    if (value) return value.startsWith('http') ? value : `https://${value}`;
  } catch {
    // Fall through to the URL matcher for CLI versions that mix text and JSON.
  }
  const match = output.match(/https:\/\/[^\s"']+\.vercel\.app/);
  if (!match) throw new Error('Vercel deployment did not return a parseable URL');
  return match[0];
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = new Error(error.cause?.code || error.name || 'fetch failed');
    }
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  throw new Error(`verification failed for ${new URL(url).hostname}: ${lastError?.message}`);
}

async function main() {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!apply) return;

  const temporaryRoot = join(spikeDir, 'tmp');
  const outputDirectory = join(spikeDir, 'output');
  await mkdir(temporaryRoot, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, `${runId}-`));
  const apiDirectory = join(temporaryDirectory, 'api');
  const frontendDirectory = join(temporaryDirectory, 'frontend');
  let vercelCreated = false;
  let cloudflareCreated = false;
  const cleanup = [];

  try {
    await cp(join(spikeDir, 'fixture/api'), apiDirectory, { recursive: true });
    await cp(join(spikeDir, 'fixture/frontend'), frontendDirectory, { recursive: true });

    run('vercel', [
      'project',
      'add',
      vercelProject,
      '--no-color',
    ]);
    vercelCreated = true;
    const protectionConfigPath = join(temporaryDirectory, 'vercel-protection.json');
    await writeFile(
      protectionConfigPath,
      `${JSON.stringify({ ssoProtection: null, passwordProtection: null })}\n`,
      'utf8',
    );
    run('vercel', [
      'api',
      `/v9/projects/${vercelProject}`,
      '--method',
      'PATCH',
      '--input',
      protectionConfigPath,
      '--silent',
      '--no-color',
    ]);
    const vercelOutput = run('vercel', [
      'deploy',
      apiDirectory,
      '--yes',
      '--non-interactive',
      '--no-color',
      '--format=json',
      '--project',
      vercelProject,
      '--env',
      `ALLOWED_ORIGIN=${pageOrigin}`,
    ]);
    const apiBaseUrl = deploymentUrl(vercelOutput);
    run('vercel', [
      'inspect',
      apiBaseUrl,
      '--wait',
      '--timeout',
      '3m',
      '--no-color',
    ]);
    const apiResponse = await fetchWithRetry(`${apiBaseUrl}/api/health`, {
      headers: { Origin: pageOrigin },
    });
    assert.equal(apiResponse.headers.get('access-control-allow-origin'), pageOrigin);
    assert.equal((await apiResponse.json()).ok, true);

    const templatePath = join(frontendDirectory, 'index.html');
    const template = await readFile(templatePath, 'utf8');
    await writeFile(templatePath, template.replace('__API_BASE_URL__', apiBaseUrl), 'utf8');

    run(wrangler, [
      'pages',
      'project',
      'create',
      cloudflareProject,
      '--production-branch',
      'main',
    ]);
    cloudflareCreated = true;
    run(wrangler, [
      'pages',
      'deploy',
      frontendDirectory,
      '--project-name',
      cloudflareProject,
      '--branch',
      branch,
      '--commit-message',
      'agent-dev dual preview spike',
      '--commit-dirty=true',
    ]);

    const pageResponse = await fetchWithRetry(pageOrigin);
    const pageSource = await pageResponse.text();
    assert.equal(pageSource.includes(apiBaseUrl), true);
    const jointApiResponse = await fetchWithRetry(`${apiBaseUrl}/api/health`, {
      headers: { Origin: pageOrigin },
    });
    assert.equal(jointApiResponse.headers.get('access-control-allow-origin'), pageOrigin);

    const evidence = {
      runId,
      apiBaseUrl,
      pageOrigin,
      apiHealth: 'passed',
      exactCors: 'passed',
      pageContainsApiUrl: 'passed',
      jointSmoke: 'passed',
    };
    await writeFile(join(outputDirectory, `${runId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (cloudflareCreated) {
      try {
        run(wrangler, ['pages', 'project', 'delete', cloudflareProject, '--yes']);
        cleanup.push({ provider: 'cloudflare', deleted: true });
      } catch {
        cleanup.push({ provider: 'cloudflare', deleted: false, project: cloudflareProject });
      }
    }
    if (vercelCreated) {
      try {
        run('vercel', ['project', 'rm', vercelProject, '--no-color'], { input: 'y\n' });
        cleanup.push({ provider: 'vercel', deleted: true });
      } catch {
        cleanup.push({ provider: 'vercel', deleted: false, project: vercelProject });
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({ cleanup })}\n`);
    if (cleanup.some(item => !item.deleted)) process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
