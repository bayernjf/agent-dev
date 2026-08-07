import type { ProviderAdapter, ProviderPlan, ProviderApplyResult, ProviderVerification, ProviderResourceSpecs, ProviderResourceSpec } from '@agent-dev/provider-core';
import { GitHubAdapter } from './github.js';
import { VercelAdapter } from './vercel.js';
import { CloudflareAdapter } from './cloudflare.js';
import { ManualProviderAdapter } from './manual.js';
import type { CommandRunner } from './cli.js';
import { defaultRunner } from './cli.js';

export type ProviderContext = {
  workspacePath: string;
  projectName: string;
};

export type RealProviderOptions = {
  resolveContext: (projectId: string) => Promise<ProviderContext | null>;
  runner?: CommandRunner;
  supabaseReason?: string;
};

const DEFAULT_SUPABASE_REASON = 'Supabase is intentionally manual because its CLI writes state outside the project boundary. Create the project through the Supabase dashboard and enter the organization in the Blueprint.';

type AdapterFactory = (spec: ProviderResourceSpec, ctx: ProviderContext, runner: CommandRunner) => ProviderAdapter;

type AdapterConfig = {
  factory: AdapterFactory;
  checkCommand: [string, string[]];
  manualReason: string;
  checkResult?: (result: { success: boolean; stdout: string; stderr: string }) => boolean;
};

const ADAPTER_FACTORIES: Record<string, AdapterConfig> = {
  github: {
    factory: (spec, ctx, runner) => new GitHubAdapter(spec.owner, ctx.projectName, ctx.workspacePath, runner),
    checkCommand: ['gh', ['auth', 'status', '--active']],
    manualReason: 'GitHub CLI is not authenticated. Run `gh auth login` first.',
  },
  vercel: {
    factory: (spec, ctx, runner) => new VercelAdapter(spec.owner, ctx.projectName, ctx.workspacePath, runner),
    checkCommand: ['vercel', ['whoami']],
    manualReason: 'Vercel CLI is not authenticated. Run `vercel login` first.',
  },
  cloudflare: {
    factory: (spec, ctx, runner) => new CloudflareAdapter(spec.owner, ctx.projectName, ctx.workspacePath, runner),
    checkCommand: ['npx', ['wrangler', 'whoami']],
    manualReason: 'Cloudflare wrangler is not authenticated. Set CLOUDFLARE_API_TOKEN or run `wrangler login`.',
    checkResult: result => result.success && !result.stdout.includes('not authenticated') && !result.stderr.includes('not authenticated'),
  },
};

export class RealProviderRegistry {
  private readonly runner: CommandRunner;
  private readonly resolveContext: (projectId: string) => Promise<ProviderContext | null>;
  private readonly supabaseReason: string;
  private readonly cliAvailability = new Map<string, boolean>();

  constructor(options: RealProviderOptions) {
    this.runner = options.runner ?? defaultRunner;
    this.resolveContext = options.resolveContext;
    this.supabaseReason = options.supabaseReason ?? DEFAULT_SUPABASE_REASON;
  }

  private async checkCliAvailable(providerId: string): Promise<boolean> {
    const cached = this.cliAvailability.get(providerId);
    if (cached !== undefined) return cached;
    const config = ADAPTER_FACTORIES[providerId];
    if (!config) return true;
    const result = await this.runner(config.checkCommand[0], config.checkCommand[1], { timeout: 15_000 });
    const available = config.checkResult ? config.checkResult(result) : result.success;
    this.cliAvailability.set(providerId, available);
    return available;
  }

  private async createAdapter(providerId: string, spec: ProviderResourceSpec, ctx: ProviderContext): Promise<ProviderAdapter> {
    if (providerId === 'supabase') {
      return new ManualProviderAdapter('supabase', this.supabaseReason);
    }
    const config = ADAPTER_FACTORIES[providerId];
    if (!config) throw new Error(`Unknown provider: ${providerId}`);
    const available = await this.checkCliAvailable(providerId);
    if (!available) {
      return new ManualProviderAdapter(providerId, config.manualReason);
    }
    return config.factory(spec, ctx, this.runner);
  }

  async plan(projectId: string, specs: ProviderResourceSpecs): Promise<ProviderPlan[]> {
    const ctx = await this.resolveContext(projectId);
    if (!ctx) throw new Error(`No workspace context for project ${projectId}. Run Apply before planning providers.`);
    return Promise.all(
      Object.entries(specs).map(async ([providerId, resources]) => {
        const adapter = await this.createAdapter(providerId, resources[0], ctx);
        return adapter.plan(resources);
      }),
    );
  }

  async apply(projectId: string, plans: ProviderPlan[], approval: { id: string; status: 'approved'; approvedAt: string }): Promise<ProviderApplyResult[]> {
    const ctx = await this.resolveContext(projectId);
    if (!ctx) throw new Error(`No workspace context for project ${projectId}. Run Apply before applying providers.`);
    const specs = this.extractSpecsFromPlans(plans);
    const settled = await Promise.allSettled(
      plans.map(async plan => {
        const spec = specs[plan.providerId]?.[0];
        if (!spec) throw new Error(`No spec found for provider ${plan.providerId}.`);
        const adapter = await this.createAdapter(plan.providerId, spec, ctx);
        return adapter.apply(plan, approval);
      }),
    );
    const results: ProviderApplyResult[] = [];
    const errors: string[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        const providerId = plans[i].providerId;
        const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        errors.push(`${providerId}: ${reason}`);
      }
    }
    if (errors.length > 0 && results.length === 0) {
      throw new Error(errors.join('; '));
    }
    if (errors.length > 0) {
      console.warn(`Provider apply partial failures: ${errors.join('; ')}`);
    }
    return results;
  }

  async verify(projectId: string, specs: ProviderResourceSpecs): Promise<ProviderVerification[]> {
    const ctx = await this.resolveContext(projectId);
    if (!ctx) throw new Error(`No workspace context for project ${projectId}. Run Apply before verifying providers.`);
    return Promise.all(
      Object.entries(specs).map(async ([providerId, resources]) => {
        const adapter = await this.createAdapter(providerId, resources[0], ctx);
        return adapter.verify(resources);
      }),
    );
  }

  private extractSpecsFromPlans(plans: ProviderPlan[]): ProviderResourceSpecs {
    const specs: ProviderResourceSpecs = {};
    for (const plan of plans) {
      specs[plan.providerId] = plan.resources.map(r => r.spec);
    }
    return specs;
  }
}
