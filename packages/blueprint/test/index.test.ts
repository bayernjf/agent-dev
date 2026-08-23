import { describe, expect, it } from 'vitest';
import { createBaselinePlan, createBlueprint, createDefaultBlueprint, createDryRunPlan, getBlueprintDecisions, productBlueprintSchema } from '../src/index.js';

describe('ProductBlueprint', () => {
  it('creates the fixed v0.1 Web SaaS Golden Path', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');

    expect(blueprint.spec.deployment.web.provider).toBe('cloudflare-pages');
    expect(blueprint.spec.deployment.api.provider).toBe('vercel-functions');
    expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
  });

  it('blocks baseline approval until every ownership target is selected', () => {
    const incomplete = createBaselinePlan(createDefaultBlueprint('Receipt Desk'));
    const complete = createBaselinePlan(createBlueprint('Receipt Desk', {
      githubOwner: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme', supabaseOrganization: 'acme',
    }));

    expect(incomplete.readyForApproval).toBe(false);
    expect(incomplete.resources).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'blocked' })]));
    expect(complete.readyForApproval).toBe(true);
  });

  it('preserves professional answers and surfaces their approval boundaries', () => {
    const blueprint = createBlueprint('Sensitive Desk', {
      mode: 'professional',
      productIntent: 'Manage receipts for a small team.',
      dataSensitivity: 'sensitive',
      analyticsProviders: ['ga4'],
      previewStrategy: 'stable-dev-api',
      customInstructions: 'Use the existing design system.',
    }, 2);

    expect(blueprint.metadata).toMatchObject({ mode: 'professional', revision: 2 });
    expect(getBlueprintDecisions(blueprint)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'privacy', mode: 'ask' }),
      expect.objectContaining({ id: 'custom', mode: 'manual' }),
    ]));
  });

  it('generates stable artifacts and a no-side-effect dry run', () => {
    const blueprint = createBlueprint('Receipt Desk', { analyticsProviders: ['ga4'] }, 3);
    const first = createDryRunPlan(blueprint);
    const second = createDryRunPlan(blueprint);

    expect(first).toEqual(second);
    expect(first.noExternalChanges).toBe(true);
      expect(first.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'config/env.contract.yaml', content: expect.stringContaining('VITE_GA4_MEASUREMENT_ID') }),
      expect.objectContaining({ path: 'generated/DELIVERY_HANDOFF.md' }),
      expect.objectContaining({ path: 'apps/web/src/main.tsx' }),
      expect.objectContaining({ path: 'tsconfig.json', content: expect.stringContaining('react-jsx') }),
      expect.objectContaining({ path: 'package.json', content: expect.stringContaining('"name": "receipt-desk"') }),
      expect.objectContaining({ path: 'vite.config.ts', content: expect.stringContaining('@vitejs/plugin-react') }),
      expect.objectContaining({ path: 'apps/api/src/index.ts', content: expect.stringContaining('/api/health') }),
      expect.objectContaining({ path: 'apps/api/src/index.ts', content: expect.stringContaining("import { handle } from 'hono/vercel';") }),
      expect.objectContaining({ path: 'apps/api/vercel.json', content: expect.stringContaining('"@vercel/node"') }),
      expect.objectContaining({ path: 'apps/api/vercel.json', content: expect.not.stringContaining('nodejs22.x') }),
      expect.objectContaining({ path: '.github/workflows/quality.yml', content: expect.stringContaining('npm install') }),
      expect.objectContaining({ path: '.github/workflows/quality.yml', content: expect.stringContaining('actions/checkout@v5') }),
      expect.objectContaining({ path: '.github/workflows/quality.yml', content: expect.stringContaining('actions/setup-node@v5') }),
    ]));
  });

  it('backs every declared quality check with a script that actually runs', () => {
    const blueprint = createBlueprint('Receipt Desk', {}, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;
    const rootPackage = JSON.parse(artifacts.find(artifact => artifact.path === 'package.json')!.content) as { scripts: Record<string, string> };

    for (const check of blueprint.spec.quality.required) {
      expect(rootPackage.scripts[check], `spec.quality.required names "${check}" but no script runs it`).toBeDefined();
      expect(rootPackage.scripts.quality).toContain(`npm run ${check}`);
    }
    // A `unit` script with no test file, or a `lint` script with no config, exits non-zero rather
    // than reporting a passing gate — so the scaffold has to ship both.
    expect(artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining(['eslint.config.js', 'apps/api/src/health.test.ts', 'scripts/smoke.mjs', '.gitignore']));
    // Agent work is committed with `git add -A`, so the generated secret file and the provider CLI
    // state directories have to be ignored or they land in the product's first pull request.
    const ignore = artifacts.find(artifact => artifact.path === '.gitignore')!.content;
    for (const rule of ['.env', '.env.*', '.agent-dev/', '.vercel/', '.wrangler/']) expect(ignore).toContain(rule);
  });
});
