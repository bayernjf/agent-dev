import { describe, expect, it } from 'vitest';
import { createBaselinePlan, createBlueprint, createDefaultBlueprint, createDryRunPlan, getBlueprintDecisions, productBlueprintSchema } from '../src/index.js';

describe('ProductBlueprint', () => {
  it('creates the fixed v0.1 Web SaaS Golden Path', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');

    expect(blueprint.spec.deployment.web.provider).toBe('cloudflare-pages');
    expect(blueprint.spec.deployment.api.provider).toBe('vercel-functions');
    expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
  });

  it('defaults the runtime to local-codex for the Golden Path', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');
    expect(blueprint.spec.runtime.provider).toBe('local-codex');
    expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
  });

  it('accepts every supported runtime provider without mutating the value', () => {
    for (const provider of ['local-codex', 'local-opencode', 'local-claude', 'local-aider', 'local-openclaw', 'local-codebuddy'] as const) {
      const blueprint = createBlueprint('Runtime Desk', { runtimeProvider: provider }, 1);
      expect(blueprint.spec.runtime.provider).toBe(provider);
      expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
    }
  });

  it('surfaces the runtime as a designer-facing decision in professional mode', () => {
    const blueprint = createBlueprint('Sensitive Desk', {
      mode: 'professional',
      runtimeProvider: 'local-opencode',
    }, 2);

    const decisions = getBlueprintDecisions(blueprint);
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime', value: 'local-opencode', mode: 'ask' }),
    ]));
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
      // setup-node defaults to dependency caching and hard-fails before `npm install` when no
      // lock file exists yet; the scaffold generates the lock file on first install, so CI must
      // disable the cache probe to let the first PR pass.
      expect.objectContaining({ path: '.github/workflows/quality.yml', content: expect.stringContaining("cache: ''") }),
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
    expect(artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining(['eslint.config.js', 'apps/api/src/health.test.ts',, 'scripts/smoke.mjs', '.gitignore']));
    // Agent work is committed with `git add -A`, so the generated secret file and the provider CLI
    // state directories have to be ignored or they land in the product's first pull request.
    const ignore = artifacts.find(artifact => artifact.path === '.gitignore')!.content;
    for (const rule of ['.env', '.env.*', '.agent-dev/', '.vercel/', '.wrangler/']) expect(ignore).toContain(rule);
  });

  it('keeps web-saas as the default product type and generates the full scaffold', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');
    expect(blueprint.spec.product.type).toBe('web-saas');
    const artifacts = createDryRunPlan(blueprint).artifacts;
    expect(artifacts.find(a => a.path === 'apps/web/src/main.tsx')).toBeDefined();
    expect(artifacts.find(a => a.path === 'apps/api/src/index.ts')).toBeDefined();
  });

  it('generates a real static-site scaffold for landing-page', () => {
    const blueprint = createBlueprint('Launch Page', { productType: 'landing-page' }, 1);
    expect(blueprint.spec.product.type).toBe('landing-page');
    const artifacts = createDryRunPlan(blueprint).artifacts;

    // Landing pages ship real templates, not a guided handoff.
    expect(artifacts.find(a => a.path === 'src/index.html')).toBeDefined();
    expect(artifacts.find(a => a.path === 'scripts/build.mjs')).toBeDefined();
    expect(artifacts.find(a => a.path === 'wrangler.toml')).toBeDefined();
    const indexHtml = artifacts.find(a => a.path === 'src/index.html')!.content;
    expect(indexHtml).toContain('<main');
    expect(indexHtml).not.toContain('api-base-url');
    // Static landings must not advertise backend secrets in the environment contract.
    const env = artifacts.find(a => a.path === 'config/env.contract.yaml')!.content;
    expect(env).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(env).not.toContain('VITE_SUPABASE_URL');
    // Governance docs still describe the static delivery baseline.
    const standard = artifacts.find(a => a.path === 'generated/PRODUCT_STANDARD.md')!.content;
    expect(standard).toContain('Static site on Cloudflare Pages');
  });

  it('does not pretend to generate extension/desktop/mobile/api-tool; returns a guided handoff instead', () => {
    for (const kind of ['browser-extension', 'desktop', 'mobile', 'api-tool'] as const) {
      const blueprint = createBlueprint('Other Desk', { productType: kind }, 1);
      expect(blueprint.spec.product.type).toBe(kind);
      expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);

      const plan = createDryRunPlan(blueprint);
      expect(plan.artifacts).toHaveLength(1);
      expect(plan.artifacts[0]!.path).toBe('generated/DELIVERY_HANDOFF.md');
      expect(plan.artifacts[0]!.content).toContain(`Product type: ${kind}`);
      expect(plan.artifacts[0]!.content).toContain('is part of the multi-product roadmap');
      // No Web scaffold is emitted for these types yet.
      expect(plan.artifacts.find(a => a.path === 'apps/web/src/main.tsx')).toBeUndefined();
    }
  });
});
