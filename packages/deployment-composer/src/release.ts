import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CommandRunner } from '@agent-dev/provider-cli';
import { defaultRunner, providerCredentialEnv } from '@agent-dev/provider-cli';
import { fetchWithRetry } from './http.js';
import { productionProjectNames, productionWebOrigin } from './names.js';

export type ReleaseStepId =
  | 'checkout-production-source'
  | 'install-release-dependencies'
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
  source: { repository: string; branch: string; commit: string; acceptedCommit: string };
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

// Production is released from the production branch of the recorded repository, not from the local
// workspace the feature was implemented in. Deploying the workspace would let code reach production
// without ever landing on the production branch, so the released version could not be reproduced
// from it.
export type ReleaseSource = {
  repository: string;
  branch: string;
  acceptedCommit: string;
  checkoutPath: string;
};

export type ReleaseComposerOptions = {
  workspacePath: string;
  projectName: string;
  source: ReleaseSource;
  /** Relative to the release checkout, not to the workspace. */
  apiDirectory?: string;
  frontendDirectory?: string;
  /** Relative to the frontend directory. */
  frontendDistDirectory?: string;
  qualityCommand?: string[];
};

const STEP_DEFINITIONS: { id: ReleaseStepId; title: string }[] = [
  { id: 'checkout-production-source', title: 'Check out the production branch of the recorded repository' },
  { id: 'install-release-dependencies', title: 'Install dependencies in the release checkout' },
  { id: 'verify-release-quality', title: 'Verify release quality gate' },
  { id: 'deploy-api-production', title: 'Deploy production API with the exact production origin' },
  { id: 'verify-api-production', title: 'Verify production API health and CORS' },
  { id: 'build-web-production', title: 'Build the frontend against the production API' },
  { id: 'deploy-web-production', title: 'Deploy the frontend to the production branch' },
  { id: 'verify-production-smoke', title: 'Verify the joint production smoke test' },
  { id: 'write-release-evidence', title: 'Write production release evidence' },
];

export function releaseStepPlan(): ReleaseStep[] {
  return STEP_DEFINITIONS.map(def => ({ ...def, status: 'pending' as const }));
}

export function releaseIdempotencyKey(projectName: string): string {
  return `release:${projectName}:production`;
}

// The production counterpart of DeploymentComposer. It deliberately does NOT disable Vercel
// Deployment Protection: that is defensible for a disposable preview and wrong for production,
// where whatever protection the account configured has to survive a release.
export class ReleaseComposer {
  private readonly workspacePath: string;
  private readonly projectName: string;
  private readonly source: ReleaseSource;
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
    this.source = options.source;
    this.apiDirectory = options.apiDirectory ?? 'apps/api';
    this.frontendDirectory = options.frontendDirectory ?? 'apps/web';
    this.frontendDistDirectory = options.frontendDistDirectory ?? 'dist';
    this.qualityCommand = options.qualityCommand ?? ['run', 'quality'];
    this.runner = runner ?? defaultRunner;
    this.steps = releaseStepPlan();
    const names = productionProjectNames(this.projectName);
    this.vercelProjectName = names.vercelProject;
    this.cloudflareProjectName = names.cloudflareProject;
  }

  get idempotencyKey(): string {
    return releaseIdempotencyKey(this.projectName);
  }

  get corsOrigin(): string {
    return productionWebOrigin(this.projectName);
  }

  private get apiPath(): string {
    return join(this.source.checkoutPath, this.apiDirectory);
  }

  private get frontendPath(): string {
    return join(this.source.checkoutPath, this.frontendDirectory);
  }

  private get frontendDistPath(): string {
    return join(this.frontendPath, this.frontendDistDirectory);
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
      case 'checkout-production-source': return this.checkoutProductionSource(step);
      case 'install-release-dependencies': return this.installReleaseDependencies(step);
      case 'verify-release-quality': return this.verifyReleaseQuality(step);
      case 'deploy-api-production': return this.deployApiProduction(step);
      case 'verify-api-production': return this.verifyApiProduction(step);
      case 'build-web-production': return this.buildWebProduction(step);
      case 'deploy-web-production': return this.deployWebProduction(step);
      case 'verify-production-smoke': return this.verifyProductionSmoke(step);
      case 'write-release-evidence': return this.writeReleaseEvidence(step);
    }
  }

  private async checkoutProductionSource(step: ReleaseStep): Promise<void> {
    const { repository, branch, acceptedCommit, checkoutPath } = this.source;
    const env = providerCredentialEnv();
    const cloned = await stat(join(checkoutPath, '.git')).then(() => true).catch(() => false);
    if (!cloned) {
      await mkdir(dirname(checkoutPath), { recursive: true });
      const result = await this.runner('gh', ['repo', 'clone', repository, checkoutPath, '--', '--branch', branch], {
        cwd: dirname(checkoutPath), timeout: 300_000, env,
      });
      if (!result.success) {
        throw new Error(`Unable to clone ${repository} branch ${branch} for the release: ${result.stderr || result.stdout}`);
      }
    }

    // Fetch and reset on every attempt: a retry that reused whatever the previous attempt left on
    // disk could ship a commit the production branch no longer points at.
    const fetched = await this.runner('git', ['fetch', 'origin', branch], { cwd: checkoutPath, timeout: 300_000, env });
    if (!fetched.success) {
      throw new Error(`Unable to fetch ${branch} from ${repository}: ${fetched.stderr || fetched.stdout}`);
    }
    const reset = await this.runner('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: checkoutPath, timeout: 60_000, env });
    if (!reset.success) {
      throw new Error(`Unable to check out ${branch} of ${repository}: ${reset.stderr || reset.stdout}`);
    }
    // Not -x: node_modules is untracked and reinstalling it on every retry buys nothing.
    await this.runner('git', ['clean', '-fd'], { cwd: checkoutPath, timeout: 60_000, env });

    const head = await this.runner('git', ['rev-parse', 'HEAD'], { cwd: checkoutPath, timeout: 30_000, env });
    if (!head.success) {
      throw new Error(`Unable to read the released commit from ${checkoutPath}: ${head.stderr || head.stdout}`);
    }
    const commit = head.stdout.trim();

    // The human approved a specific delivery. If that commit has not landed on the production
    // branch, this release would ship something nobody accepted.
    const carriesAccepted = await this.runner('git', ['merge-base', '--is-ancestor', acceptedCommit, commit], {
      cwd: checkoutPath, timeout: 30_000, env,
    });
    if (!carriesAccepted.success) {
      throw new Error(`The accepted commit ${acceptedCommit} is not part of ${repository} branch ${branch}, so production would not carry the accepted delivery. Merge the delivery pull request into ${branch} first.`);
    }

    this.observations.source = { repository, branch, commit, acceptedCommit };
    step.detail = `Releasing ${repository} branch ${branch} at ${commit}`;
  }

  private async installReleaseDependencies(step: ReleaseStep): Promise<void> {
    const result = await this.runner('npm', ['install'], {
      cwd: this.source.checkoutPath, timeout: 600_000,
    });
    if (!result.success) {
      throw new Error(`Dependency installation in the release checkout failed: ${result.stderr || result.stdout}`);
    }
    step.detail = `Dependencies installed in ${this.source.checkoutPath}`;
  }

  private async verifyReleaseQuality(step: ReleaseStep): Promise<void> {
    const result = await this.runner('npm', this.qualityCommand, {
      cwd: this.source.checkoutPath,
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
      cwd: this.source.checkoutPath, timeout: 30_000, env,
    });
    if (!projectResult.success && !projectResult.stderr.includes('already exists')) {
      throw new Error(`Vercel production project creation failed: ${projectResult.stderr || projectResult.stdout}`);
    }

    const deployResult = await this.runner('vercel', [
      'deploy', this.apiPath,
      '--prod', '--yes', '--non-interactive', '--no-color', '--format=json',
      '--project', this.vercelProjectName,
      '--env', `ALLOWED_ORIGIN=${this.corsOrigin}`,
    ], { cwd: this.source.checkoutPath, timeout: 300_000, env });

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
      cwd: this.source.checkoutPath, timeout: 60_000, env,
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
    const whoami = await this.runner('vercel', ['whoami', '--no-color'], { cwd: this.source.checkoutPath, timeout: 30_000, env });
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
    await writeFile(join(this.frontendPath, '.env.production'), `VITE_API_BASE_URL=${this.apiBaseUrl}\n`, 'utf8');
    const result = await this.runner('npm', ['run', 'build'], {
      cwd: this.frontendPath,
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
      cwd: this.source.checkoutPath, timeout: 60_000, env,
    });
    const alreadyExists = `${createResult.stderr}${createResult.stdout}`.includes('already exists');
    if (!createResult.success && !alreadyExists) {
      throw new Error(`Cloudflare Pages production project creation failed: ${createResult.stderr || createResult.stdout}`);
    }

    const deployResult = await this.runner('npx', [
      'wrangler', 'pages', 'deploy', this.frontendDistPath,
      '--project-name', this.cloudflareProjectName,
      '--branch', 'main',
      '--commit-message', `agent-dev release: ${this.projectName}`,
    ], { cwd: this.source.checkoutPath, timeout: 300_000, env });
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
    const { source, releaseQuality, apiHealth, webPage, productionSmoke } = this.observations;
    if (!source || !releaseQuality || !apiHealth || !webPage || !productionSmoke) {
      throw new Error('Release evidence cannot be written before every verification step has produced an observation.');
    }

    const evidence: ReleaseEvidence = {
      projectName: this.projectName,
      apiBaseUrl: this.apiBaseUrl,
      webUrl: this.webUrl,
      corsOrigin: this.corsOrigin,
      observations: { source, releaseQuality, apiHealth, webPage, productionSmoke },
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
