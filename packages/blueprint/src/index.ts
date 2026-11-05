import { z } from 'zod';
import { baselineProvidersFor } from './generate.js';
import { RUNTIME_PROVIDER_MAX_LENGTH, qualityChecksFor } from './decisions.js';
export {
  getBlueprintDecisions,
  isRuntimeProviderId,
  qualityChecksFor,
  RUNTIME_PROVIDER_MAX_LENGTH,
  type BlueprintDecision,
} from './decisions.js';
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
// Profile ids are created at runtime, so they cannot be a fixed enum. Validation that the referenced
// agent/profile actually exists and is executable happens in the storage layer at run time. The
// browser-side twin is `isRuntimeProviderId`, and both read `RUNTIME_PROVIDER_MAX_LENGTH`.
export const runtimeProviderSchema = z.string().min(1).max(RUNTIME_PROVIDER_MAX_LENGTH);

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

// `getBlueprintDecisions` moved to `decisions.ts`, which imports no zod. The re-export above keeps
// existing imports from the package root working.
