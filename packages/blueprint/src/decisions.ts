import type { ProductBlueprint } from './index.js';
import { baselineProvidersFor, PRODUCT_TYPE_DESCRIPTORS, type BaselineProviderId } from './generate.js';

// This module holds the blueprint helpers that only read an already-parsed blueprint object. It
// imports no zod, so the browser bundle can use these without shipping the schema runtime (see
// `client.ts`). The zod schemas themselves stay in `index.ts`.

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

// Runtime provider accepts built-in agent ids (with `local-` prefix) or dynamic Agent Profile ids.
// Profile ids are created by users at runtime, so they cannot be a fixed enum. Validation that the
// referenced agent/profile actually exists and is executable happens in the storage layer at run
// time. Both the zod schema below and `isRuntimeProviderId` read this length, so the browser and
// the server cannot drift apart.
export const RUNTIME_PROVIDER_MAX_LENGTH = 120;

export function isRuntimeProviderId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= RUNTIME_PROVIDER_MAX_LENGTH;
}

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
