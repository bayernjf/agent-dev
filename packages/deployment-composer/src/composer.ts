import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandRunner, CliResult } from '@agent-dev/provider-cli';
import { defaultRunner, providerCredentialEnv } from '@agent-dev/provider-cli';
import type { PreviewStep, PreviewStepId, PreviewComposerOptions, PreviewDeploymentResult, PreviewEvidence } from './steps.js';

const STEP_DEFINITIONS: { id: PreviewStepId; title: string }[] = [
  { id: 'deploy-vercel-preview', title: 'Deploy Vercel API Preview with exact CORS origin' },
  { id: 'verify-api-health', title: 'Verify API health endpoint' },
  { id: 'inject-api-url', title: 'Inject VITE_API_BASE_URL into frontend build' },
  { id: 'build-frontend', title: 'Build frontend application' },
  { id: 'deploy-cloudflare-preview', title: 'Deploy Cloudflare Pages preview branch' },
  { id: 'verify-joint-smoke', title: 'Verify joint page + API smoke test' },
  { id: 'write-evidence', title: 'Write deployment evidence' },
];

export class DeploymentComposer {
  private readonly workspacePath: string;
  private readonly projectName: string;
  private readonly previewBranch: string;
  private readonly apiDirectory: string;
  private readonly frontendDirectory: string;
  private readonly frontendDistDirectory: string;
  private readonly runner: CommandRunner;

  private steps: PreviewStep[];
  private apiBaseUrl: string | undefined;
  private pagesUrl: string | undefined;
  private vercelProjectName: string | undefined;
  private cloudflareProjectName: string | undefined;

  constructor(options: PreviewComposerOptions, runner?: CommandRunner) {
    this.workspacePath = options.workspacePath;
    this.projectName = options.projectName;
    this.previewBranch = options.previewBranch;
    this.apiDirectory = options.apiDirectory ?? join(this.workspacePath, 'apps/api');
    this.frontendDirectory = options.frontendDirectory ?? join(this.workspacePath, 'apps/web');
    this.frontendDistDirectory = options.frontendDistDirectory ?? join(this.frontendDirectory, 'dist');
    this.runner = runner ?? defaultRunner;
    this.steps = STEP_DEFINITIONS.map(def => ({ ...def, status: 'pending' as const }));
    this.vercelProjectName = `${this.projectName}-api-${this.previewBranch}`;
    this.cloudflareProjectName = `${this.projectName}-web-${this.previewBranch}`;
  }

  get idempotencyKey(): string {
    return `preview:${this.projectName}:${this.previewBranch}`;
  }

  get corsOrigin(): string {
    return `https://${this.previewBranch}.${this.cloudflareProjectName}.pages.dev`;
  }

  plan(): PreviewStep[] {
    return this.steps.map(step => ({ ...step }));
  }

  async execute(): Promise<PreviewDeploymentResult> {
    let status: PreviewDeploymentResult['status'] = 'completed';

    for (const step of this.steps) {
      if (step.status === 'completed') continue;
      step.status = 'running';
      try {
        await this.executeStep(step);
        step.status = 'completed';
      } catch (error) {
        step.status = 'failed';
        step.detail = error instanceof Error ? error.message : String(error);
        status = 'failed';
        break;
      }
    }

    const result: PreviewDeploymentResult = {
      status,
      steps: this.steps.map(s => ({ ...s })),
      apiBaseUrl: this.apiBaseUrl,
      pagesUrl: this.pagesUrl,
      corsOrigin: this.corsOrigin,
    };

    if (status === 'failed') {
      result.cleanupRequired = {
        vercel: this.vercelProjectName,
        cloudflare: this.cloudflareProjectName,
      };
    }

    return result;
  }

  private async executeStep(step: PreviewStep): Promise<void> {
    switch (step.id) {
      case 'deploy-vercel-preview':
        await this.deployVercelPreview(step);
        break;
      case 'verify-api-health':
        await this.verifyApiHealth(step);
        break;
      case 'inject-api-url':
        await this.injectApiUrl(step);
        break;
      case 'build-frontend':
        await this.buildFrontend(step);
        break;
      case 'deploy-cloudflare-preview':
        await this.deployCloudflarePreview(step);
        break;
      case 'verify-joint-smoke':
        await this.verifyJointSmoke(step);
        break;
      case 'write-evidence':
        await this.writeEvidence(step);
        break;
    }
  }

  private async deployVercelPreview(step: PreviewStep): Promise<void> {
    const env = { ...providerCredentialEnv(), CI: 'true', VERCEL_TELEMETRY_DISABLED: '1' };

    // Create project if it does not exist (idempotent: vercel project add is safe to re-run)
    const projectResult = await this.runner('vercel', ['project', 'add', this.vercelProjectName!, '--no-color'], {
      cwd: this.workspacePath,
      timeout: 30_000,
      env,
    });
    // Ignore "already exists" errors
    if (!projectResult.success && !projectResult.stderr.includes('already exists')) {
      throw new Error(`Vercel project creation failed: ${projectResult.stderr || projectResult.stdout}`);
    }

    // Deploy to preview with exact CORS origin
    const deployResult = await this.runner('vercel', [
      'deploy',
      this.apiDirectory,
      '--yes',
      '--non-interactive',
      '--no-color',
      '--format=json',
      '--project', this.vercelProjectName!,
      '--env', `ALLOWED_ORIGIN=${this.corsOrigin}`,
    ], {
      cwd: this.workspacePath,
      timeout: 180_000,
      env,
    });

    if (!deployResult.success) {
      throw new Error(`Vercel preview deployment failed: ${deployResult.stderr || deployResult.stdout}`);
    }

    this.apiBaseUrl = this.parseDeploymentUrl(deployResult.stdout);
    step.detail = `Deployed to ${this.apiBaseUrl}`;
  }

  private async verifyApiHealth(step: PreviewStep): Promise<void> {
    if (!this.apiBaseUrl) throw new Error('API base URL is not set.');
    const healthUrl = `${this.apiBaseUrl}/api/health`;
    const response = await fetchWithRetry(healthUrl, {
      headers: { Origin: this.corsOrigin },
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Health endpoint did not return JSON: content-type=${contentType}`);
    }

    const corsHeader = response.headers.get('access-control-allow-origin');
    if (corsHeader !== this.corsOrigin) {
      throw new Error(`CORS mismatch: expected ${this.corsOrigin}, got ${corsHeader ?? 'none'}`);
    }

    step.detail = `API healthy, exact CORS verified for ${this.corsOrigin}`;
  }

  private async injectApiUrl(step: PreviewStep): Promise<void> {
    if (!this.apiBaseUrl) throw new Error('API base URL is not set.');
    const envContent = `VITE_API_BASE_URL=${this.apiBaseUrl}\n`;
    const envPath = join(this.frontendDirectory, '.env.preview');
    writeFileSync(envPath, envContent, 'utf8');
    step.detail = `Wrote VITE_API_BASE_URL to ${envPath}`;
  }

  private async buildFrontend(step: PreviewStep): Promise<void> {
    const result = await this.runner('npm', ['run', 'build'], {
      cwd: this.frontendDirectory,
      timeout: 180_000,
      env: { ...process.env, VITE_API_BASE_URL: this.apiBaseUrl ?? '' } as Record<string, string>,
    });
    if (!result.success) {
      throw new Error(`Frontend build failed: ${result.stderr || result.stdout}`);
    }
    step.detail = 'Frontend built successfully.';
  }

  private async deployCloudflarePreview(step: PreviewStep): Promise<void> {
    const env = providerCredentialEnv();

    // Create Cloudflare Pages project (idempotent)
    const createResult = await this.runner('npx', ['wrangler', 'pages', 'project', 'create', this.cloudflareProjectName!, '--production-branch', 'main'], {
      cwd: this.workspacePath,
      timeout: 60_000,
      env: { ...env, WRANGLER_LOG: 'none' },
    });
    if (!createResult.success && !createResult.stderr.includes('already exists')) {
      throw new Error(`Cloudflare Pages project creation failed: ${createResult.stderr || createResult.stdout}`);
    }

    // Deploy to preview branch
    const deployResult = await this.runner('npx', [
      'wrangler', 'pages', 'deploy',
      this.frontendDistDirectory,
      '--project-name', this.cloudflareProjectName!,
      '--branch', this.previewBranch,
      '--commit-message', `agent-dev preview: ${this.projectName}/${this.previewBranch}`,
    ], {
      cwd: this.workspacePath,
      timeout: 180_000,
      env: { ...env, WRANGLER_LOG: 'none' },
    });
    if (!deployResult.success) {
      throw new Error(`Cloudflare Pages deployment failed: ${deployResult.stderr || deployResult.stdout}`);
    }

    this.pagesUrl = this.corsOrigin;
    step.detail = `Deployed to ${this.pagesUrl}`;
  }

  private async verifyJointSmoke(step: PreviewStep): Promise<void> {
    if (!this.pagesUrl) throw new Error('Pages URL is not set.');
    if (!this.apiBaseUrl) throw new Error('API base URL is not set.');

    // Verify page contains the API URL
    const pageResponse = await fetchWithRetry(this.pagesUrl);
    const pageSource = await pageResponse.text();
    if (!pageSource.includes(this.apiBaseUrl)) {
      throw new Error('Page source does not contain the injected API base URL.');
    }

    // Verify API CORS with Pages origin
    const apiResponse = await fetchWithRetry(`${this.apiBaseUrl}/api/health`, {
      headers: { Origin: this.pagesUrl },
    });
    const corsHeader = apiResponse.headers.get('access-control-allow-origin');
    if (corsHeader !== this.pagesUrl) {
      throw new Error(`Joint CORS check failed: expected ${this.pagesUrl}, got ${corsHeader ?? 'none'}`);
    }

    step.detail = 'Joint smoke passed: page contains API URL, CORS is exact.';
  }

  private async writeEvidence(step: PreviewStep): Promise<void> {
    if (!this.apiBaseUrl || !this.pagesUrl) throw new Error('Deployment URLs not set.');

    const evidence: PreviewEvidence = {
      projectName: this.projectName,
      previewBranch: this.previewBranch,
      apiBaseUrl: this.apiBaseUrl,
      pagesUrl: this.pagesUrl,
      corsOrigin: this.corsOrigin,
      apiHealth: 'passed',
      exactCors: 'passed',
      pageContainsApiUrl: 'passed',
      jointSmoke: 'passed',
      completedAt: new Date().toISOString(),
    };

    const outputDir = join(this.workspacePath, '.agent-dev', 'previews');
    mkdirSync(outputDir, { recursive: true });
    const evidencePath = join(outputDir, `${this.projectName}-${this.previewBranch}.json`);
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    step.detail = `Evidence written to ${evidencePath}`;
  }

  private parseDeploymentUrl(output: string): string {
    // Try JSON format first (vercel deploy --format=json)
    try {
      const jsonStart = output.indexOf('{');
      const jsonEnd = output.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
        const url = parsed.url || parsed.deployment?.url;
        if (url) return url.startsWith('http') ? url : `https://${url}`;
      }
    } catch { /* Fall through to regex */ }

    // Fallback: extract vercel.app URL
    const match = output.match(/https:\/\/[^\s"']+\.vercel\.app/);
    if (match) return match[0];
    throw new Error('Could not parse deployment URL from Vercel output.');
  }
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 5): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise(resolve => setTimeout(resolve, 4_000));
  }
  throw new Error(`Verification failed for ${new URL(url).hostname}: ${lastError?.message ?? 'unknown'}`);
}
