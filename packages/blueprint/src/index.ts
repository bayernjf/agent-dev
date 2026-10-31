import { z } from 'zod';
import { baselineProvidersFor, PRODUCT_TYPE_DESCRIPTORS, type BaselineProviderId } from './generate.js';
export {
  baselineProvidersFor,
  createBaselinePlan,
  createDryRunPlan,
  generateArtifacts,
  getManualActions,
  type BaselinePlan,
  type BaselinePlanResource,
  type BaselineProviderId,
  type DryRunPlan,
  type GeneratedArtifact,
  type ManualAction,
} from './generate.js';

// Every product type now ships a generated template: web-app, landing-page, browser-extension,
// desktop (Tauri v2 by default, Electron in professional mode), mobile (Expo) and api-tool.
// See multi-product-delivery-plan.md for what stays a manual step per type (signing, store review).
export const productTypeSchema = z.enum([
  'web-app',
  'landing-page',
  'browser-extension',
  'desktop',
  'mobile',
  'api-tool',
  // Tier0 独立站双用 L1：storefront 是同一电商内核（commerce-os）的独立站前台模板。
  // 结构固定为 Astro SSR + React 岛；行业差异（零售/跨境/订阅）由 storefrontProfile 轴配置化。
  'storefront',
]);
// 独立站行业剖面：同一 storefront 骨架的配置化差异，不是三种产品类型。
// retail=品牌零售（默认）；cross-border=多币种展示 + 价格货币化占位；subscription=周期订单占位。
export const storefrontProfileSchema = z.enum(['retail', 'cross-border', 'subscription']);
// TF-04：模板→Blueprint 的配置化输入。结构由 productType=storefront + profile 决定；商品/主题/文案
// 由 storefrontConfig 注入，管道据此生成同构站。商品为种子占位（真实目录仍来自 commerce-os SSR 投影）。
export const storefrontSeedProductSchema = z.object({
  title: z.string().trim().min(1).max(120),
  price: z.number().nonnegative(),
  currency: z.string().trim().length(3).default('CNY'),
});
export const storefrontConfigSchema = z.object({
  themeColor: z.string().trim().max(40).default('#b45309'),
  tagline: z.string().trim().max(200).default(''),
  seedProducts: z.array(storefrontSeedProductSchema).default([]),
});
export const blueprintModeSchema = z.enum(['beginner', 'professional']);
// Tauri is the default desktop shell (small bundles, Rust core). Electron is offered in
// professional mode for teams that need Node APIs in the main process or already ship Electron.
export const desktopShellSchema = z.enum(['tauri', 'electron']);
export const analyticsProviderSchema = z.enum(['ga4', 'clarity']);

// Runtime provider accepts built-in agent ids (with `local-` prefix) or dynamic Agent Profile ids.
// Profile ids are created by users at runtime, so they cannot be a fixed enum. Validation that the
// referenced agent/profile actually exists and is executable happens in the storage layer at run time.
export const runtimeProviderSchema = z.string().min(1).max(120);

export const blueprintAnswersSchema = z.object({
  mode: blueprintModeSchema.default('beginner'),
  productType: productTypeSchema.default('web-app'),
  productIntent: z.string().trim().max(500).default(''),
  dataSensitivity: z.enum(['standard', 'sensitive']).default('standard'),
  previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']).default('per-pull-request'),
  analyticsProviders: z.array(analyticsProviderSchema).default([]),
  runtimeProvider: runtimeProviderSchema.default('local-codex'),
  desktopShell: desktopShellSchema.default('tauri'),
  storefrontProfile: storefrontProfileSchema.default('retail'),
  storefrontConfig: storefrontConfigSchema.default({}),
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
  // Defaults on the persisted schema are a read migration, not input leniency: `createBlueprint`
  // always writes these fields, but rows written before a field existed do not carry it, and a
  // required field made every one of them fail validation inside `getProject` — a 500 on every route
  // that loads the project, which bricked all pre-existing deliveries. Each default is the value the
  // older blueprint implied: beginner mode, no stated intent, no custom instructions, and Tauri,
  // which was the only desktop shell when the field was introduced.
  metadata: z.object({
    name: z.string().min(2).max(80),
    revision: z.number().int().positive(),
    mode: blueprintModeSchema.default('beginner'),
    productIntent: z.string().max(500).default(''),
    customInstructions: z.string().max(1000).default(''),
  }),
  spec: z.object({
    product: z.object({
      type: productTypeSchema,
      dataSensitivity: z.enum(['standard', 'sensitive']),
      desktopShell: desktopShellSchema.default('tauri'),
      // Defaults on read migration: blueprints persisted before the storefront axis existed imply
      // the brand-retail profile, so adding it cannot brick pre-existing rows the way a required
      // field did (see the mode/productIntent note below).
      storefrontProfile: storefrontProfileSchema.default('retail'),
    }),
    // TF-04：配置化商品/主题/文案。Read-migration default so pre-existing storefront blueprints
    // (and non-storefront types) keep validating; only the storefront builder reads it.
    storefrontConfig: storefrontConfigSchema.default({}),
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
    // `'none'` is a real state, not a placeholder: an MCP server has no Pages project and no Vercel
    // deployment, and a blueprint that names one anyway is a false claim about the delivery — the
    // field is what the final report and any future consumer reads to decide what exists. Which
    // providers a type actually gets is `baselineProvidersFor`, the same source the baseline plan uses.
    data: z.object({
      provider: z.enum(['supabase', 'none']),
      auth: z.enum(['supabase-auth', 'none']),
      organization: z.string().max(120).default(''),
    }),
    deployment: z.object({
      web: z.object({ provider: z.enum(['cloudflare-pages', 'none']), account: z.string().max(120).default('') }),
      api: z.object({ provider: z.enum(['vercel-functions', 'none']), team: z.string().max(120).default('') }),
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
      // 'eval' marks a baseline evaluation command: its output must carry a machine-readable
      // score summary (EVAL_SUMMARY {...} or an `eval-score: <0-1>` line) that the Agent-Dev
      // Quality Gate parses into eval-report.json (FR5-4). The gate verdict still follows the
      // command exit code, never the parsed score.
      required: z.array(z.enum(['lint', 'typecheck', 'unit', 'build', 'smoke', 'rust-check', 'eval'])),
    }),
  }),
});

export type ProductBlueprint = z.infer<typeof productBlueprintSchema>;

export type BlueprintDecision = {
  id: string;
  title: string;
  titleKey?: string;
  value: string;
  valueKey?: string;
  valueParams?: Record<string, string | number>;
  mode: 'auto' | 'ask' | 'manual';
  reason: string;
  reasonKey?: string;
};

// Every check named here has to be a real script in that product type's generated package.json,
// otherwise the generated `quality` gate dies mid-run and CI can never go green.
const QUALITY_CHECKS: Record<string, ProductBlueprint['spec']['quality']['required']> = {
  'web-app': ['lint', 'typecheck', 'unit', 'build', 'smoke'],
  'landing-page': ['lint', 'build'],
  'browser-extension': ['typecheck', 'build'],
  'desktop:tauri': ['typecheck', 'build', 'rust-check'],
  'desktop:electron': ['typecheck', 'build'],
  mobile: ['typecheck'],
  'api-tool': ['lint', 'typecheck', 'unit', 'build'],
  // Storefront is a skeleton: build assembles the SSR page set and smoke asserts the profile-specific
  // markers. No astro/supabase install is required for the gate to go green (see scripts/build.mjs).
  // eval runs the shipped baseline runner (scripts/eval-run.mjs --baseline); the platform Quality
  // Gate parses its EVAL_SUMMARY output into eval-report.json without ever softening the verdict.
  'storefront': ['build', 'smoke', 'eval'],
};

export function qualityChecksFor(productType: string, desktopShell = 'tauri'): ProductBlueprint['spec']['quality']['required'] {
  const key = productType === 'desktop' ? `desktop:${desktopShell}` : productType;
  return QUALITY_CHECKS[key] ?? QUALITY_CHECKS['web-app']!;
}

export function createBlueprint(name: string, input: Partial<BlueprintAnswers> = {}, revision = 1): ProductBlueprint {
  const answers = blueprintAnswersSchema.parse(input);
  const providers = baselineProvidersFor(productTypeSchema.parse(answers.productType));
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
        storefrontProfile: storefrontProfileSchema.parse(answers.storefrontProfile),
      },
      storefrontConfig: storefrontConfigSchema.parse(answers.storefrontConfig),
      stack: { frontend: 'react-vite', api: 'hono', packageManager: 'npm' },
      sourceControl: {
        provider: 'github',
        owner: answers.githubOwner,
        integrationBranch: 'dev',
        productionBranch: 'main',
        requirePullRequest: true,
      },
      data: providers.includes('supabase')
        ? { provider: 'supabase', auth: 'supabase-auth', organization: answers.supabaseOrganization }
        : { provider: 'none', auth: 'none', organization: '' },
      deployment: {
        web: providers.includes('cloudflare')
          ? { provider: 'cloudflare-pages', account: answers.cloudflareAccount }
          : { provider: 'none', account: '' },
        api: providers.includes('vercel')
          ? { provider: 'vercel-functions', team: answers.vercelTeam }
          : { provider: 'none', team: '' },
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

// How each cloud provider is named to a user. Keyed on every baseline provider except `github` —
// GitHub is source control, not a cloud account, and the card this feeds is titled "Cloud account
// connection". `satisfies` makes a seventh provider a compile error until it declares a label.
const CLOUD_PROVIDER_LABELS = {
  supabase: 'Supabase',
  vercel: 'Vercel Functions',
  cloudflare: 'Cloudflare Pages',
} as const satisfies Record<Exclude<BaselineProviderId, 'github'>, string>;

type CloudProviderId = keyof typeof CLOUD_PROVIDER_LABELS;

function cloudProvidersOf(productType: ProductBlueprint['spec']['product']['type']): readonly CloudProviderId[] {
  return baselineProvidersFor(productType).filter(
    (provider): provider is CloudProviderId => provider !== 'github',
  );
}

export function getBlueprintDecisions(blueprint: ProductBlueprint): BlueprintDecision[] {
  const analytics = blueprint.spec.analytics.providers;
  const productType = blueprint.spec.product.type;
  // Both cards below used to name one product type's stack and all four cloud providers for every
  // blueprint, so an MCP server was offered a Supabase organization and a Vercel team while its own
  // generated PRODUCT_STANDARD.md said data and auth were "Not provisioned for this product type".
  // Reading the per-type table that writes that document is what makes the two unable to drift.
  const descriptor = PRODUCT_TYPE_DESCRIPTORS[productType];
  const cloudProviders = cloudProvidersOf(productType);
  const decisions: BlueprintDecision[] = [
    {
      id: 'stack',
      title: 'Application baseline',
      titleKey: 'decision.stack.title',
      value: `${descriptor.frontend} | ${descriptor.backend}`,
      mode: 'auto',
      reason: 'The same delivery baseline is written into generated/PRODUCT_STANDARD.md.',
      reasonKey: 'decision.stack.reason',
    },
    {
      id: 'source-control',
      title: 'Git delivery workflow',
      titleKey: 'decision.sourceControl.title',
      value: 'GitHub PRs from dev to main',
      valueKey: 'decision.sourceControl.value',
      mode: 'auto',
      reason: 'Protected production delivery remains part of the baseline.',
      reasonKey: 'decision.sourceControl.reason',
    },
    {
      id: 'providers',
      title: 'Cloud account connection',
      titleKey: 'decision.providers.title',
      value: cloudProviders.length === 0
        ? 'None — this product type provisions nothing outside its GitHub repository'
        : cloudProviders.map(provider => CLOUD_PROVIDER_LABELS[provider]).join(', '),
      mode: 'manual',
      reason: cloudProviders.length === 0
        ? 'Authorizing GitHub remains yours to do; no cloud account is requested.'
        : 'Account authorization and resource ownership stay with you.',
      reasonKey: cloudProviders.length === 0
        ? 'decision.providers.reason.none'
        : 'decision.providers.reason.hasProviders',
    },
    {
      id: 'production',
      title: 'Production release',
      titleKey: 'decision.production.title',
      value: 'Human approval required',
      valueKey: 'decision.production.value',
      mode: 'ask',
      reason: 'A production deployment must never be inferred from local work.',
      reasonKey: 'decision.production.reason',
    },
  ];

  decisions.push({
    id: 'privacy',
    title: 'Product data sensitivity',
    titleKey: 'decision.privacy.title',
    value: blueprint.spec.product.dataSensitivity,
    valueKey: `decision.privacy.value.${blueprint.spec.product.dataSensitivity}`,
    mode: blueprint.spec.product.dataSensitivity === 'sensitive' ? 'ask' : 'auto',
    reason: blueprint.spec.product.dataSensitivity === 'sensitive'
      ? 'Sensitive data requires an explicit privacy and access review.'
      : 'Standard product data uses the default security baseline.',
    reasonKey: blueprint.spec.product.dataSensitivity === 'sensitive'
      ? 'decision.privacy.reason.sensitive'
      : 'decision.privacy.reason.standard',
  });

  decisions.push({
    id: 'preview',
    title: 'Preview strategy',
    titleKey: 'decision.preview.title',
    value: blueprint.spec.deployment.previewStrategy.replaceAll('-', ' '),
    valueKey: `decision.preview.value.${blueprint.spec.deployment.previewStrategy}`,
    mode: blueprint.spec.deployment.previewStrategy === 'per-pull-request' ? 'auto' : 'ask',
    reason: blueprint.spec.deployment.previewStrategy === 'per-pull-request'
      ? 'Each pull request can use an isolated preview by default.'
      : 'A stable dev API changes a shared environment and needs confirmation.',
    reasonKey: blueprint.spec.deployment.previewStrategy === 'per-pull-request'
      ? 'decision.preview.reason.perPullRequest'
      : 'decision.preview.reason.stableDevApi',
  });

  decisions.push({
    id: 'analytics',
    title: 'Analytics',
    titleKey: 'decision.analytics.title',
    value: analytics.length === 0 ? 'None' : analytics.join(', ').toUpperCase(),
    valueKey: analytics.length === 0 ? 'decision.analytics.value.none' : 'decision.analytics.value.hasProviders',
    valueParams: analytics.length > 0 ? { providers: analytics.join(', ').toUpperCase() } : undefined,
    mode: analytics.length === 0 ? 'auto' : 'ask',
    reason: analytics.length === 0
      ? 'No tracking setup is required.'
      : 'Analytics affects privacy notices, account authorization and environment variables.',
    reasonKey: analytics.length === 0
      ? 'decision.analytics.reason.none'
      : 'decision.analytics.reason.hasProviders',
  });

  const runtimeProvider = blueprint.spec.runtime.provider;
  decisions.push({
    id: 'runtime',
    title: 'Local agent runtime',
    titleKey: 'decision.runtime.title',
    value: runtimeProvider,
    // In beginner mode the verified default is chosen automatically. In professional mode the caller
    // passes an explicit runtimeProvider (ask), so we surface it as a confirmed choice.
    mode: blueprint.metadata.mode === 'beginner' ? 'auto' : 'ask',
    reason:
      blueprint.metadata.mode === 'beginner'
        ? 'Beginner mode uses the verified default local agent (local-codex).'
        : 'Professional mode selects which local agent runtime implements the feature tasks.',
    reasonKey:
      blueprint.metadata.mode === 'beginner'
        ? 'decision.runtime.reason.beginner'
        : 'decision.runtime.reason.professional',
  });

  if (blueprint.metadata.customInstructions) {
    decisions.push({
      id: 'custom',
      title: 'Custom implementation note',
      titleKey: 'decision.custom.title',
      value: blueprint.metadata.customInstructions,
      mode: 'manual',
      reason: 'Custom instructions are preserved, but are not automated until a supported module exists.',
      reasonKey: 'decision.custom.reason',
    });
  }
  return decisions;
}
