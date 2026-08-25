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

  it('backs every declared quality check with a script that actually runs, for every generated product type', () => {
    // The gate is one `npm run quality` chain: a check declared in the contract but missing from
    // scripts stops the chain with "Missing script", so the product's CI can never go green.
    const combos = [
      { productType: 'web-saas' },
      { productType: 'landing-page' },
      { productType: 'browser-extension' },
      { productType: 'desktop', desktopShell: 'tauri' },
      { productType: 'desktop', desktopShell: 'electron' },
      { productType: 'mobile' },
      { productType: 'api-tool' },
    ] as const;
    for (const combo of combos) {
      const productType = combo.productType;
      const blueprint = createBlueprint('Receipt Desk', combo, 1);
      const artifacts = createDryRunPlan(blueprint).artifacts;
      const rootPackage = JSON.parse(artifacts.find(artifact => artifact.path === 'package.json')!.content) as { scripts: Record<string, string> };

      expect(blueprint.spec.quality.required.length, `${productType} declares no quality checks`).toBeGreaterThan(0);
      for (const check of blueprint.spec.quality.required) {
        expect(rootPackage.scripts[check], `${productType}: spec.quality.required names "${check}" but no script runs it`).toBeDefined();
        expect(rootPackage.scripts.quality, `${productType}: quality script skips "${check}"`).toContain(`npm run ${check}`);
      }
    }
  });

  it('ships the config and fixtures the web-saas quality checks need', () => {
    const artifacts = createDryRunPlan(createBlueprint('Receipt Desk', {}, 1)).artifacts;
    // A `unit` script with no test file, or a `lint` script with no config, exits non-zero rather
    // than reporting a passing gate — so the scaffold has to ship both.
    expect(artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining(['eslint.config.js', 'apps/api/src/health.test.ts', 'scripts/smoke.mjs', '.gitignore']));
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

  it('generates a real browser-extension (MV3) scaffold with a web-store delivery handoff', () => {
    const blueprint = createBlueprint('Tab Guardian', { productType: 'browser-extension' }, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;

    // Real extension source, not a guided handoff.
    expect(artifacts.find(a => a.path === 'manifest.config.ts')).toBeDefined();
    expect(artifacts.find(a => a.path === 'vite.config.ts')).toBeDefined();
    expect(artifacts.find(a => a.path === 'popup.html')).toBeDefined();
    expect(artifacts.find(a => a.path === 'options.html')).toBeDefined();
    expect(artifacts.find(a => a.path === 'src/background.ts')).toBeDefined();
    expect(artifacts.find(a => a.path === 'src/content.ts')).toBeDefined();
    // Governance docs are still emitted.
    expect(artifacts.find(a => a.path === 'generated/PRODUCT_STANDARD.md')).toBeDefined();
    // No Web SaaS scaffold is emitted.
    expect(artifacts.find(a => a.path === 'apps/web/src/main.tsx')).toBeUndefined();
    // The handoff is the normal governance one, not the "not yet auto-generated" placeholder.
    expect(artifacts.find(a => a.path === 'generated/DELIVERY_HANDOFF.md')?.content).not.toContain('not yet');
  });

  // Both assertions below pin defects found by really running the generated `quality` script:
  // without DOM/node libs and skipLibCheck, `tsc --noEmit` fails on vite's own typings, and a
  // manifest icon the generator never emits makes `vite build` fail with a missing asset.
  it('generates a browser-extension scaffold whose own quality gate can pass', () => {
    const artifacts = createDryRunPlan(createBlueprint('Tab Guardian', { productType: 'browser-extension' }, 1)).artifacts;
    const tsconfig = JSON.parse(artifacts.find(a => a.path === 'tsconfig.json')!.content);
    expect(tsconfig.compilerOptions.lib).toContain('DOM');
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(true);
    expect(tsconfig.compilerOptions.types).toContain('node');
    expect(JSON.parse(artifacts.find(a => a.path === 'package.json')!.content).devDependencies['@types/node']).toBeDefined();
    expect(artifacts.find(a => a.path === 'manifest.config.ts')!.content).not.toContain('default_icon');
  });

  it('generates a Tauri v2 desktop scaffold whose own quality gate can pass', () => {
    const blueprint = createBlueprint('Soft Desk', { productType: 'desktop' }, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;
    const path = (value: string) => artifacts.find(a => a.path === value);

    // Governance layer still applies to desktop products.
    expect(path('generated/PRODUCT_STANDARD.md')).toBeDefined();
    expect(path('generated/DELIVERY_HANDOFF.md')!.content).not.toContain('not yet');

    expect(path('src-tauri/tauri.conf.json')).toBeDefined();
    expect(path('src-tauri/src/lib.rs')!.content).toContain('tauri::generate_handler![app_version]');
    // The webview really calls the Rust command, so a broken IPC surface fails visibly.
    expect(path('src/main.ts')!.content).toContain("invoke<string>('app_version')");

    // `tauri::generate_context!` refuses to compile without bundle.icon on disk, and a text-only
    // generator cannot emit a PNG — so the scaffold ships a script that writes a placeholder.
    const conf = JSON.parse(path('src-tauri/tauri.conf.json')!.content);
    expect(conf.bundle.icon).toEqual(['icons/icon.png']);
    expect(path('scripts/ensure-icon.mjs')).toBeDefined();
    const scripts = JSON.parse(path('package.json')!.content).scripts as Record<string, string>;
    expect(scripts['rust-check']).toContain('node scripts/ensure-icon.mjs');

    // Cargo package/crate names cannot contain hyphens where they are used as a Rust path.
    expect(path('src-tauri/Cargo.toml')!.content).toContain('name = "soft_desk"');
    expect(path('src-tauri/src/main.rs')!.content).toContain('soft_desk_lib::run()');

    // cargo check needs the Rust toolchain and the Linux webview headers in CI.
    const workflow = path('.github/workflows/quality.yml')!.content;
    expect(workflow).toContain('dtolnay/rust-toolchain@stable');
    expect(workflow).toContain('libwebkit2gtk-4.1-dev');

    expect(path('.gitignore')!.content).toContain('src-tauri/target/');
  });

  it('generates an Electron desktop scaffold when professional mode picks that shell', () => {
    const blueprint = createBlueprint('Soft Desk', { productType: 'desktop', desktopShell: 'electron' }, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;
    const path = (value: string) => artifacts.find(a => a.path === value);

    expect(path('src-tauri/tauri.conf.json')).toBeUndefined();
    expect(path('electron/main.ts')!.content).toContain("ipcMain.handle('app-version'");
    // The renderer must not get Node APIs of its own; the preload bridge is the only channel.
    expect(path('electron/main.ts')!.content).toContain('nodeIntegration: false');
    expect(path('electron/preload.ts')!.content).toContain('contextBridge.exposeInMainWorld');
    // Electron loads the built renderer over file://, where an absolute base 404s every chunk.
    expect(path('vite.config.mts')!.content).toContain("base: './'");
    expect(path('electron-builder.yml')).toBeDefined();
    expect(blueprint.spec.quality.required).toEqual(['typecheck', 'build']);
  });

  it('generates an Expo mobile scaffold with the store steps kept manual', () => {
    const blueprint = createBlueprint('Soft Desk', { productType: 'mobile' }, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;
    const path = (value: string) => artifacts.find(a => a.path === value);

    expect(path('generated/PRODUCT_STANDARD.md')).toBeDefined();
    expect(path('generated/DELIVERY_HANDOFF.md')!.content).not.toContain('not yet');
    expect(path('app/_layout.tsx')!.content).toContain("from 'expo-router'");
    expect(path('app/index.tsx')).toBeDefined();
    expect(path('eas.json')).toBeDefined();
    // Bundle identifiers are dotted and reject the hyphens a product slug carries.
    expect(JSON.parse(path('app.json')!.content).expo.ios.bundleIdentifier).toBe('io.agentdev.softdesk');
    expect(path('generated/DISTRIBUTION.md')!.content).toContain('eas submit');
  });

  it('generates an MCP server, the one API-first shape with its own delivery path', () => {
    const blueprint = createBlueprint('Soft Desk', { productType: 'api-tool' }, 1);
    const artifacts = createDryRunPlan(blueprint).artifacts;
    const path = (value: string) => artifacts.find(a => a.path === value);

    expect(path('generated/DELIVERY_HANDOFF.md')!.content).not.toContain('not yet');
    expect(path('src/server.ts')!.content).toContain("server.registerTool(");
    // The client spawns the built entry as a command, so it needs both a bin and a shebang.
    expect(JSON.parse(path('package.json')!.content).bin).toEqual({ 'soft-desk': 'dist/index.js' });
    expect(path('src/index.ts')!.content.startsWith('#!/usr/bin/env node')).toBe(true);
    // stdout carries JSON-RPC; a stray console.log there breaks the client's parser.
    expect(path('src/index.ts')!.content).toContain('console.error');
    expect(path('src/index.ts')!.content).not.toContain('console.log');
    // Nothing is deployed to a URL for this type.
    expect(path('vercel.json')).toBeUndefined();
    expect(path('wrangler.toml')).toBeUndefined();
    expect(path('index.html')).toBeUndefined();
    expect(path('generated/DISTRIBUTION.md')!.content).toContain('claude_desktop_config.json');
  });
});
