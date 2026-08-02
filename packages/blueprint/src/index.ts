import { z } from 'zod';

export const productTypeSchema = z.literal('web-saas');

export const productBlueprintSchema = z.object({
  apiVersion: z.literal('agent-dev.io/v1alpha1'),
  kind: z.literal('ProductBlueprint'),
  metadata: z.object({
    name: z.string().min(2).max(80),
    revision: z.number().int().positive(),
  }),
  spec: z.object({
    product: z.object({
      type: productTypeSchema,
      dataSensitivity: z.enum(['standard', 'sensitive']).default('standard'),
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
    analytics: z.object({ providers: z.array(z.enum(['ga4', 'clarity'])) }),
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

export function createDefaultBlueprint(name: string): ProductBlueprint {
  return productBlueprintSchema.parse({
    apiVersion: 'agent-dev.io/v1alpha1',
    kind: 'ProductBlueprint',
    metadata: { name, revision: 1 },
    spec: {
      product: { type: 'web-saas', dataSensitivity: 'standard' },
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
        previewStrategy: 'per-pull-request',
      },
      analytics: { providers: [] },
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
