import { z } from 'zod';
export {
  createBaselinePlan,
  createDryRunPlan,
  generateArtifacts,
  getManualActions,
  type BaselinePlan,
  type BaselinePlanResource,
  type DryRunPlan,
  type GeneratedArtifact,
  type ManualAction,
} from './generate.js';

// Every product type now ships a generated template: web-saas, landing-page, browser-extension,
// desktop (Tauri v2 by default, Electron in professional mode), mobile (Expo) and api-tool.
// See multi-product-delivery-plan.md for what stays a manual step per type (signing, store review).
export const productTypeSchema = z.enum([
  'web-saas',
  'landing-page',
  'browser-extension',
  'desktop',
  'mobile',
  'api-tool',
]);
export const blueprintModeSchema = z.enum(['beginner', 'professional']);
// Tauri is the default desktop shell (small bundles, Rust core). Electron is offered in
// professional mode for teams that need Node APIs in the main process or already ship Electron.
export const desktopShellSchema = z.enum(['tauri', 'electron']);
export const analyticsProviderSchema = z.enum(['ga4', 'clarity']);

// Runtime provider ids must match keys in the agent-runtime AGENT_ADAPTERS registry. `local-` is a
// namespace prefix so Blueprint stays explicit about which local Agent is chosen.
export const runtimeProviderSchema = z.enum([
  'local-codex',
  'local-opencode',
  'local-claude',
  'local-aider',
  'local-openclaw',
  'local-codebuddy',
]);

export const blueprintAnswersSchema = z.object({
  mode: blueprintModeSchema.default('beginner'),
  productType: productTypeSchema.default('web-saas'),
  productIntent: z.string().trim().max(500).default(''),
  dataSensitivity: z.enum(['standard', 'sensitive']).default('standard'),
  previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']).default('per-pull-request'),
  analyticsProviders: z.array(analyticsProviderSchema).default([]),
  runtimeProvider: runtimeProviderSchema.default('local-codex'),
  desktopShell: desktopShellSchema.default('tauri'),
  customInstructions: z.string().trim().max(1000).default(''),
  githubOwner: z.string().trim().max(120).default(''),
  vercelTeam: z.string().trim().max(120).default(''),
  cloudflareAccount: z.string().trim().max(120).default(''),
  supabaseOrganization: z.string().trim().max(120).default(''),
});

export type BlueprintAnswers = z.infer<typeof blueprintAnswersSchema>;

export const productBlueprintSchema = z.object({
  apiVersion: z.literal('agent-dev.io/v1alpha1'),
  kind: z.literal('ProductBlueprint'),
  metadata: z.object({
    name: z.string().min(2).max(80),
    revision: z.number().int().positive(),
    mode: blueprintModeSchema,
    productIntent: z.string().max(500),
    customInstructions: z.string().max(1000),
  }),
  spec: z.object({
    product: z.object({
      type: productTypeSchema,
      dataSensitivity: z.enum(['standard', 'sensitive']),
      desktopShell: desktopShellSchema,
    }),
    stack: z.object({
      frontend: z.literal('react-vite'),
      api: z.literal('hono'),
      packageManager: z.literal('npm'),
    }),
    sourceControl: z.object({
      provider: z.literal('github'),
      owner: z.string().max(120).default(''),
      integrationBranch: z.string().min(1),
      productionBranch: z.string().min(1),
      requirePullRequest: z.boolean(),
    }),
    data: z.object({
      provider: z.literal('supabase'),
      auth: z.literal('supabase-auth'),
      organization: z.string().max(120).default(''),
    }),
    deployment: z.object({
      web: z.object({ provider: z.literal('cloudflare-pages'), account: z.string().max(120).default('') }),
      api: z.object({ provider: z.literal('vercel-functions'), team: z.string().max(120).default('') }),
      previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']),
    }),
    analytics: z.object({ providers: z.array(analyticsProviderSchema) }),
    runtime: z.object({ provider: runtimeProviderSchema }),
    policy: z.object({
      productionApproval: z.literal('required'),
      maxAutomaticFixAttempts: z.literal(2),
      secretChangesRequireApproval: z.literal(true),
    }),
    quality: z.object({
      required: z.array(z.enum(['lint', 'typecheck', 'unit', 'build', 'smoke', 'rust-check'])),
    }),
  }),
});

export type ProductBlueprint = z.infer<typeof productBlueprintSchema>;

export type BlueprintDecision = {
  id: string;
  title: string;
  value: string;
  mode: 'auto' | 'ask' | 'manual';
  reason: string;
};

// Every check named here has to be a real script in that product type's generated package.json,
// otherwise the generated `quality` gate dies mid-run and CI can never go green.
const QUALITY_CHECKS: Record<string, ProductBlueprint['spec']['quality']['required']> = {
  'web-saas': ['lint', 'typecheck', 'unit', 'build', 'smoke'],
  'landing-page': ['lint', 'build'],
  'browser-extension': ['typecheck', 'build'],
  'desktop:tauri': ['typecheck', 'build', 'rust-check'],
  'desktop:electron': ['typecheck', 'build'],
  mobile: ['typecheck'],
  'api-tool': ['lint', 'typecheck', 'unit', 'build'],
};

export function qualityChecksFor(productType: string, desktopShell = 'tauri'): ProductBlueprint['spec']['quality']['required'] {
  const key = productType === 'desktop' ? `desktop:${desktopShell}` : productType;
  return QUALITY_CHECKS[key] ?? QUALITY_CHECKS['web-saas']!;
}

export function createBlueprint(name: string, input: Partial<BlueprintAnswers> = {}, revision = 1): ProductBlueprint {
  const answers = blueprintAnswersSchema.parse(input);
  return productBlueprintSchema.parse({
    apiVersion: 'agent-dev.io/v1alpha1',
    kind: 'ProductBlueprint',
    metadata: {
      name,
      revision,
      mode: answers.mode,
      productIntent: answers.productIntent,
      customInstructions: answers.customInstructions,
    },
    spec: {
      product: {
        type: productTypeSchema.parse(answers.productType),
        dataSensitivity: answers.dataSensitivity,
        desktopShell: desktopShellSchema.parse(answers.desktopShell),
      },
      stack: { frontend: 'react-vite', api: 'hono', packageManager: 'npm' },
      sourceControl: {
        provider: 'github',
        owner: answers.githubOwner,
        integrationBranch: 'dev',
        productionBranch: 'main',
        requirePullRequest: true,
      },
      data: { provider: 'supabase', auth: 'supabase-auth', organization: answers.supabaseOrganization },
      deployment: {
        web: { provider: 'cloudflare-pages', account: answers.cloudflareAccount },
        api: { provider: 'vercel-functions', team: answers.vercelTeam },
        previewStrategy: answers.previewStrategy,
      },
      analytics: { providers: answers.analyticsProviders },
      runtime: { provider: runtimeProviderSchema.parse(answers.runtimeProvider) },
      policy: {
        productionApproval: 'required',
        maxAutomaticFixAttempts: 2,
        secretChangesRequireApproval: true,
      },
      quality: { required: qualityChecksFor(answers.productType, answers.desktopShell) },
    },
  });
}

export function createDefaultBlueprint(name: string): ProductBlueprint {
  return createBlueprint(name);
}

export function getBlueprintDecisions(blueprint: ProductBlueprint): BlueprintDecision[] {
  const analytics = blueprint.spec.analytics.providers;
  const decisions: BlueprintDecision[] = [
    {
      id: 'stack',
      title: 'Application baseline',
      value: 'React/Vite, Hono and npm workspaces',
      mode: 'auto',
      reason: 'This is the tested v0.1 Web SaaS golden path.',
    },
    {
      id: 'source-control',
      title: 'Git delivery workflow',
      value: 'GitHub PRs from dev to main',
      mode: 'auto',
      reason: 'Protected production delivery remains part of the baseline.',
    },
    {
      id: 'providers',
      title: 'Cloud account connection',
      value: 'Supabase, Cloudflare Pages and Vercel Functions',
      mode: 'manual',
      reason: 'Account authorization and resource ownership stay with you.',
    },
    {
      id: 'production',
      title: 'Production release',
      value: 'Human approval required',
      mode: 'ask',
      reason: 'A production deployment must never be inferred from local work.',
    },
  ];

  decisions.push({
    id: 'privacy',
    title: 'Product data sensitivity',
    value: blueprint.spec.product.dataSensitivity,
    mode: blueprint.spec.product.dataSensitivity === 'sensitive' ? 'ask' : 'auto',
    reason: blueprint.spec.product.dataSensitivity === 'sensitive'
      ? 'Sensitive data requires an explicit privacy and access review.'
      : 'Standard product data uses the default security baseline.',
  });

  decisions.push({
    id: 'preview',
    title: 'Preview strategy',
    value: blueprint.spec.deployment.previewStrategy.replaceAll('-', ' '),
    mode: blueprint.spec.deployment.previewStrategy === 'per-pull-request' ? 'auto' : 'ask',
    reason: blueprint.spec.deployment.previewStrategy === 'per-pull-request'
      ? 'Each pull request can use an isolated preview by default.'
      : 'A stable dev API changes a shared environment and needs confirmation.',
  });

  decisions.push({
    id: 'analytics',
    title: 'Analytics',
    value: analytics.length === 0 ? 'None' : analytics.join(', ').toUpperCase(),
    mode: analytics.length === 0 ? 'auto' : 'ask',
    reason: analytics.length === 0
      ? 'No tracking setup is required.'
      : 'Analytics affects privacy notices, account authorization and environment variables.',
  });

  const runtimeProvider = blueprint.spec.runtime.provider;
  decisions.push({
    id: 'runtime',
    title: 'Local agent runtime',
    value: runtimeProvider,
    // In beginner mode the verified default is chosen automatically. In professional mode the caller
    // passes an explicit runtimeProvider (ask), so we surface it as a confirmed choice.
    mode: blueprint.metadata.mode === 'beginner' ? 'auto' : 'ask',
    reason:
      blueprint.metadata.mode === 'beginner'
        ? 'Beginner mode uses the verified default local agent (local-codex).'
        : 'Professional mode selects which local agent runtime implements the feature tasks.',
  });

  if (blueprint.metadata.customInstructions) {
    decisions.push({
      id: 'custom',
      title: 'Custom implementation note',
      value: blueprint.metadata.customInstructions,
      mode: 'manual',
      reason: 'Custom instructions are preserved, but are not automated until a supported module exists.',
    });
  }
  return decisions;
}
