import { z } from 'zod';

export const productTypeSchema = z.literal('web-saas');
export const blueprintModeSchema = z.enum(['beginner', 'professional']);
export const analyticsProviderSchema = z.enum(['ga4', 'clarity']);

export const blueprintAnswersSchema = z.object({
  mode: blueprintModeSchema.default('beginner'),
  productIntent: z.string().trim().max(500).default(''),
  dataSensitivity: z.enum(['standard', 'sensitive']).default('standard'),
  previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']).default('per-pull-request'),
  analyticsProviders: z.array(analyticsProviderSchema).default([]),
  customInstructions: z.string().trim().max(1000).default(''),
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
    }),
    stack: z.object({
      frontend: z.literal('react-vite'),
      api: z.literal('hono'),
      packageManager: z.literal('npm'),
    }),
    sourceControl: z.object({
      provider: z.literal('github'),
      integrationBranch: z.string().min(1),
      productionBranch: z.string().min(1),
      requirePullRequest: z.boolean(),
    }),
    data: z.object({
      provider: z.literal('supabase'),
      auth: z.literal('supabase-auth'),
    }),
    deployment: z.object({
      web: z.object({ provider: z.literal('cloudflare-pages') }),
      api: z.object({ provider: z.literal('vercel-functions') }),
      previewStrategy: z.enum(['per-pull-request', 'stable-dev-api']),
    }),
    analytics: z.object({ providers: z.array(analyticsProviderSchema) }),
    runtime: z.object({ provider: z.literal('local-codex') }),
    policy: z.object({
      productionApproval: z.literal('required'),
      maxAutomaticFixAttempts: z.literal(2),
      secretChangesRequireApproval: z.literal(true),
    }),
    quality: z.object({
      required: z.array(z.enum(['lint', 'typecheck', 'unit', 'build', 'smoke'])),
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
      product: { type: 'web-saas', dataSensitivity: answers.dataSensitivity },
      stack: { frontend: 'react-vite', api: 'hono', packageManager: 'npm' },
      sourceControl: {
        provider: 'github',
        integrationBranch: 'dev',
        productionBranch: 'main',
        requirePullRequest: true,
      },
      data: { provider: 'supabase', auth: 'supabase-auth' },
      deployment: {
        web: { provider: 'cloudflare-pages' },
        api: { provider: 'vercel-functions' },
        previewStrategy: answers.previewStrategy,
      },
      analytics: { providers: answers.analyticsProviders },
      runtime: { provider: 'local-codex' },
      policy: {
        productionApproval: 'required',
        maxAutomaticFixAttempts: 2,
        secretChangesRequireApproval: true,
      },
      quality: { required: ['lint', 'typecheck', 'unit', 'build', 'smoke'] },
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
