import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandRunner } from '@agent-dev/provider-cli';
import { defaultRunner, providerCredentialEnv } from '@agent-dev/provider-cli';
import { fetchWithRetry } from './http.js';
import { productionProjectNames, productionWebOrigin } from './names.js';

export type ReleaseStepId =
  | 'verify-release-quality'
  | 'deploy-api-production'
  | 'verify-api-production'
  | 'build-web-production'
  | 'deploy-web-production'
  | 'verify-production-smoke'
  | 'write-release-evidence';

export type ReleaseStep = {
  id: ReleaseStepId;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

// As with the preview evidence, every field is something a step observed. A verdict string here
// would only restate the code path that wrote it.
export type ReleaseObservations = {
  releaseQuality: { command: string; exitCode: number };
  apiHealth: { url: string; httpStatus: number; contentType: string; observedCorsHeader: string };
  webPage: { url: string; httpStatus: number; sourceBytes: number; matchedApiBaseUrl: string };
  productionSmoke: { apiHealthUrl: string; apiHttpStatus: number; observedCorsHeader: string };
};

export type ReleaseEvidence = {
  projectName: string;
  apiBaseUrl: string;
  webUrl: string;
  corsOrigin: string;
  observations: ReleaseObservations;
  completedAt: string;
};

export type ReleaseResult = {
  status: 'completed' | 'failed';
  steps: ReleaseStep[];
  apiBaseUrl?: string;
  webUrl?: string;
  corsOrigin: string;
  observations?: ReleaseObservations;
};

export type ReleaseComposerOptions = {
  workspacePath: string;
  projectName: string;
  apiDirectory?: string;
  frontendDirectory?: string;
  frontendDistDirectory?: string;
  qualityCommand?: string[];
};

const STEP_DEFINITIONS: { id: ReleaseStepId; title: string }[] = [
  { id: 'verify-release-quality', title: 'Verify release quality gate' },
  { id: 'deploy-api-production', title: 'Deploy production API with the exact production origin' },
  { id: 'verify-api-production', title: 'Verify production API health and CORS' },
  { id: 'build-web-production', title: 'Build the frontend against the production API' },
  { id: 'deploy-web-production', title: 'Deploy the frontend to the production branch' },
  { id: 'verify-production-smoke', title: 'Verify the joint production smoke test' },
  { id: 'write-release-evidence', title: 'Write production release evidence' },
];

// The production counterpart of DeploymentComposer. It deliberately does NOT disable Vercel
// Deployment Protection: that is defensible for a disposable preview and wrong for production,
// where whatever protection the account configured has to survive a release.
export class ReleaseComposer {
  private readonly workspacePath: string;
  private readonly projectName: string;
  private readonly apiDirectory: string;
  private readonly frontendDirectory: string;
  private readonly frontendDistDirectory: string;
  private readonly qualityCommand: string[];
  private readonly runner: CommandRunner;
  private readonly vercelProjectName: string;
  private readonly cloudflareProjectName: string;

  private steps: ReleaseStep[];
  private apiBaseUrl: string | undefined;
  private webUrl: string | undefined;
  private observations: Partial<ReleaseObservations> = {};

  constructor(options: ReleaseComposerOptions, runner?: CommandRunner) {
    this.workspacePath = options.workspacePath;
    this.projectName = options.projectName;
    this.apiDirectory = options.apiDirectory ?? join(this.workspacePath, 'apps/api');
    this.frontendDirectory = options.frontendDirectory ?? join(this.workspacePath, 'apps/web');
    this.frontendDistDirectory = options.frontendDistDirectory ?? join(this.frontendDirectory, 'dist');
    this.qualityCommand = options.qualityCommand ?? ['run', 'quality'];
    this.runner = runner ?? defaultRunner;
    this.steps = STEP_DEFINITIONS.map(def => ({ ...def, status: 'pending' as const }));
    const names = productionProjectNames(this.projectName);
    this.vercelProjectName = names.vercelProject;
    this.cloudflareProjectName = names.cloudflareProject;
  }

  get idempotencyKey(): string {
    return `release:${this.projectName}:production`;
  }

  get corsOrigin(): string {
    return productionWebOrigin(this.projectName);
  }

  plan(): ReleaseStep[] {
    return this.steps.map(step => ({ ...step }));
  }

  async execute(): Promise<ReleaseResult> {
    let status: ReleaseResult['status'] = 'completed';

    for (const step of this.steps) {
      if (step.status === 'completed') continue;
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      try {
        await this.executeStep(step);
        step.status = 'completed';
      } catch (error) {
        step.status = 'failed';
        step.detail = error instanceof Error ? error.message : String(error);
        status = 'failed';
      }
      step.completedAt = new Date().toISOString();
      if (status === 'failed') break;
    }

    return {
      status,
      steps: this.steps.map(step => ({ ...step })),
      apiBaseUrl: this.apiBaseUrl,
      webUrl: this.webUrl,
      corsOrigin: this.corsOrigin,
      observations: status === 'completed' ? (this.observations as ReleaseObservations) : undefined,
    };
  }

  private async executeStep(step: ReleaseStep): Promise<void> {
    switch (step.id) {
      case 'verify-release-quality': return this.verifyReleaseQuality(step);
      case 'deploy-api-production': return this.deployApiProduction(step);
      case 'verify-api-production': return this.verifyApiProduction(step);
      case 'build-web-production': return this.buildWebProduction(step);
      case 'deploy-web-production': return this.deployWebProduction(step);
      case 'verify-production-smoke': return this.verifyProductionSmoke(step);
      case 'write-release-evidence': return this.writeReleaseEvidence(step);
    }
  }

  private async verifyReleaseQuality(step: ReleaseStep): Promise<void> {
    const result = await this.runner('npm', this.qualityCommand, {
      cwd: this.workspacePath,
      timeout: 600_000,
    });
    if (!result.success) {
      throw new Error(`Release quality gate failed: ${result.stderr || result.stdout}`);
    }
    this.observations.releaseQuality = { command: `npm ${this.qualityCommand.join(' ')}`, exitCode: result.exitCode };
    step.detail = `Quality gate passed: npm ${this.qualityCommand.join(' ')}`;
  }

  private async deployApiProduction(step: ReleaseStep): Promise<void> {
    const env = { ...providerCredentialEnv(), CI: 'true', VERCEL_TELEMETRY_DISABLED: '1' };
    await this.ensureVercelAuth(env);

    const projectResult = await this.runner('vercel', ['project', 'add', this.vercelProjectName, '--no-color'], {
      cwd: this.workspacePath, timeout: 30_000, env,
    });
    if (!projectResult.success && !projectResult.stderr.includes('already exists')) {
      throw new Error(`Vercel production project creation failed: ${projectResult.stderr || projectResult.stdout}`);
    }

    const deployResult = await this.runner('vercel', [
      'deploy', this.apiDirectory,
      '--prod', '--yes', '--non-interactive', '--no-color', '--format=json',
      '--project', this.vercelProjectName,
      '--env', `ALLOWED_ORIGIN=${this.corsOrigin}`,
    ], { cwd: this.workspacePath, timeout: 300_000, env });

    if (!deployResult.success) {
      throw new Error(`Vercel production deployment failed: ${deployResult.stderr || deployResult.stdout}`);
    }

    const deploymentUrl = parseVercelUrl(deployResult.stdout);
    this.apiBaseUrl = await this.resolveProductionAlias(deploymentUrl, env);
    step.detail = `Production API deployed to ${deploymentUrl}, served at ${this.apiBaseUrl}`;
  }

  // Deployment Protection guards the immutable deployment URL, and this composer deliberately keeps
  // it enabled for production. Verifying that URL reports a healthy API as broken, and worse, the
  // frontend would be built against it and ship a production site that cannot reach its own API.
  private async resolveProductionAlias(deploymentUrl: string, env: Record<string, string>): Promise<string> {
    const inspected = await this.runner('vercel', ['inspect', deploymentUrl, '--format=json', '--no-color'], {
      cwd: this.workspacePath, timeout: 60_000, env,
    });
    if (!inspected.success) {
      throw new Error(`Unable to inspect the production deployment ${deploymentUrl}: ${inspected.stderr || inspected.stdout}`);
    }
    const aliases = parseVercelAliases(inspected.stdout);
    if (!aliases.length) {
      throw new Error(`The production deployment ${deploymentUrl} has no alias, so it is only reachable at its protected deployment URL.`);
    }
    // The shortest alias is the project's own production hostname. The longer ones carry the team
    // scope and stay behind Deployment Protection, exactly like the deployment URL.
    const alias = [...aliases].sort((left, right) => left.length - right.length)[0];
    return alias.startsWith('http') ? alias : `https://${alias}`;
  }

  private async ensureVercelAuth(env: Record<string, string>): Promise<void> {
    if (env.VERCEL_TOKEN || process.env.VERCEL_TOKEN) return;
    const whoami = await this.runner('vercel', ['whoami', '--no-color'], { cwd: this.workspacePath, timeout: 30_000, env });
    if (!whoami.success) {
      throw new Error('Vercel is not authenticated; set VERCEL_TOKEN or run `vercel login` before releasing to production.');
    }
  }

  private async verifyApiProduction(step: ReleaseStep): Promise<void> {
    if (!this.apiBaseUrl) throw new Error('Production API base URL is not set.');
    const healthUrl = `${this.apiBaseUrl}/api/health`;
    const response = await fetchWithRetry(healthUrl, { headers: { Origin: this.corsOrigin } });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Production health endpoint did not return JSON: content-type=${contentType}`);
    }
    const corsHeader = response.headers.get('access-control-allow-origin');
    if (corsHeader !== this.corsOrigin) {
      throw new Error(`Production CORS mismatch: expected ${this.corsOrigin}, got ${corsHeader ?? 'none'}`);
    }

    this.observations.apiHealth = { url: healthUrl, httpStatus: response.status, contentType, observedCorsHeader: corsHeader };
    step.detail = `Production API healthy (HTTP ${response.status}) with exact CORS for ${this.corsOrigin}`;
  }

  private async buildWebProduction(step: ReleaseStep): Promise<void> {
    if (!this.apiBaseUrl) throw new Error('Production API base URL is not set.');
    await writeFile(join(this.frontendDirectory, '.env.production'), `VITE_API_BASE_URL=${this.apiBaseUrl}\n`, 'utf8');
    const result = await this.runner('npm', ['run', 'build'], {
      cwd: this.frontendDirectory,
      timeout: 300_000,
      env: { ...process.env, VITE_API_BASE_URL: this.apiBaseUrl } as Record<string, string>,
    });
    if (!result.success) {
      throw new Error(`Production frontend build failed: ${result.stderr || result.stdout}`);
    }
    step.detail = `Frontend built against ${this.apiBaseUrl}`;
  }

  private async deployWebProduction(step: ReleaseStep): Promise<void> {
    const env = providerCredentialEnv();
    const createResult = await this.runner('npx', ['wrangler', 'pages', 'project', 'create', this.cloudflareProjectName, '--production-branch', 'main'], {
      cwd: this.workspacePath, timeout: 60_000, env,
    });
    const alreadyExists = `${createResult.stderr}${createResult.stdout}`.includes('already exists');
    if (!createResult.success && !alreadyExists) {
      throw new Error(`Cloudflare Pages production project creation failed: ${createResult.stderr || createResult.stdout}`);
    }

    const deployResult = await this.runner('npx', [
      'wrangler', 'pages', 'deploy', this.frontendDistDirectory,
      '--project-name', this.cloudflareProjectName,
      '--branch', 'main',
      '--commit-message', `agent-dev release: ${this.projectName}`,
    ], { cwd: this.workspacePath, timeout: 300_000, env });
    if (!deployResult.success) {
      throw new Error(`Cloudflare Pages production deployment failed: ${deployResult.stderr || deployResult.stdout}`);
    }

    // The production branch is served from the project apex, which is also the origin the API was
    // deployed with. The per-deployment hash URL Wrangler prints is not that origin.
    this.webUrl = this.corsOrigin;
    step.detail = `Production frontend deployed to ${this.webUrl}`;
  }

  private async verifyProductionSmoke(step: ReleaseStep): Promise<void> {
    if (!this.webUrl || !this.apiBaseUrl) throw new Error('Production URLs are not set.');
    const pageResponse = await fetchWithRetry(this.webUrl);
    const pageSource = await pageResponse.text();
    if (!pageSource.includes(this.apiBaseUrl)) {
      throw new Error('Production page source does not contain the production API base URL.');
    }

    const apiResponse = await fetchWithRetry(`${this.apiBaseUrl}/api/health`, { headers: { Origin: this.corsOrigin } });
    const corsHeader = apiResponse.headers.get('access-control-allow-origin');
    if (corsHeader !== this.corsOrigin) {
      throw new Error(`Production joint CORS check failed: expected ${this.corsOrigin}, got ${corsHeader ?? 'none'}`);
    }

    this.observations.webPage = {
      url: this.webUrl, httpStatus: pageResponse.status,
      sourceBytes: Buffer.byteLength(pageSource, 'utf8'), matchedApiBaseUrl: this.apiBaseUrl,
    };
    this.observations.productionSmoke = {
      apiHealthUrl: `${this.apiBaseUrl}/api/health`, apiHttpStatus: apiResponse.status, observedCorsHeader: corsHeader,
    };
    step.detail = `Production smoke passed: page HTTP ${pageResponse.status} contains the API URL, API HTTP ${apiResponse.status}.`;
  }

  private async writeReleaseEvidence(step: ReleaseStep): Promise<void> {
    if (!this.apiBaseUrl || !this.webUrl) throw new Error('Production URLs are not set.');
    const { releaseQuality, apiHealth, webPage, productionSmoke } = this.observations;
    if (!releaseQuality || !apiHealth || !webPage || !productionSmoke) {
      throw new Error('Release evidence cannot be written before every verification step has produced an observation.');
    }

    const evidence: ReleaseEvidence = {
      projectName: this.projectName,
      apiBaseUrl: this.apiBaseUrl,
      webUrl: this.webUrl,
      corsOrigin: this.corsOrigin,
      observations: { releaseQuality, apiHealth, webPage, productionSmoke },
      completedAt: new Date().toISOString(),
    };

    const outputDir = join(this.workspacePath, '.agent-dev', 'releases');
    await mkdir(outputDir, { recursive: true });
    const evidencePath = join(outputDir, `${this.projectName}-production.json`);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    step.detail = `Release evidence written to ${evidencePath}`;
  }
}

function parseVercelAliases(output: string): string[] {
  try {
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return [];
    const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
    return Array.isArray(parsed.aliases) ? parsed.aliases.filter((alias: unknown): alias is string => typeof alias === 'string' && alias.length > 0) : [];
  } catch {
    return [];
  }
}

function parseVercelUrl(output: string): string {
  try {
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
      const url = parsed.url || parsed.deployment?.url;
      if (url) return url.startsWith('http') ? url : `https://${url}`;
    }
  } catch { /* fall through to the regex below */ }
  const match = output.match(/https:\/\/[^\s"']+\.vercel\.app/);
  if (match) return match[0];
  throw new Error('Could not parse the production deployment URL from Vercel output.');
}
