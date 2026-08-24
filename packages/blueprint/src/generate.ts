import type { ProductBlueprint } from './index.js';

// id is intentionally a string rather than a fixed literal union: each product type contributes its
// own template ids (e.g. `template-landing-index`), and a closed union would force every type to
// share the web-saas ids. The generator owns the namespace; tests assert by stable `path`.
export type GeneratedArtifact = {
  id: string;
  title: string;
  path: string;
  content: string;
};

export type ManualAction = {
  id: string;
  title: string;
  reason: string;
  steps: string[];
  verification: string;
};

export type DryRunPlan = {
  blueprintRevision: number;
  noExternalChanges: true;
  summary: string;
  automaticPreparation: string[];
  manualActions: ManualAction[];
  artifacts: GeneratedArtifact[];
};

export type BaselinePlanResource = {
  id: 'github-repository' | 'supabase-project' | 'vercel-api' | 'cloudflare-pages';
  title: string;
  owner: string | null;
  status: 'blocked' | 'requires-approval';
  reason: string;
};

export type BaselinePlan = {
  blueprintRevision: number;
  noExternalChanges: true;
  readyForApproval: boolean;
  summary: string;
  resources: BaselinePlanResource[];
};

// Describes how the Governance layer (shared docs) should describe each product type's stack.
// `hasBackend` gates whether backend/server-side env vars appear in the Environment Contract: static
// types (landing page, extension, desktop, mobile) must not advertise Supabase/Vercel secrets.
export const PRODUCT_TYPE_DESCRIPTORS: Record<string, { frontend: string; backend: string; deploySteps: string; hasBackend: boolean }> = {
  'web-saas': {
    frontend: 'React/Vite on Cloudflare Pages',
    backend: 'Hono on Vercel Functions',
    deploySteps: 'Deploy the Vercel API Preview, then the Cloudflare Pages Preview.',
    hasBackend: true,
  },
  'landing-page': {
    frontend: 'Static site on Cloudflare Pages',
    backend: 'None (static, client-rendered)',
    deploySteps: 'Deploy the Cloudflare Pages Preview (static build).',
    hasBackend: false,
  },
  'browser-extension': {
    frontend: 'Manifest V3 + Popup/Options (TypeScript) + Background service worker + Content scripts',
    backend: 'None required by default; Supabase optional for accounts / remote config',
    deploySteps:
      'Build with Vite + @crxjs/vite-plugin into `dist/`, load unpacked from `chrome://extensions`, '
      + 'then package `dist/` and submit to the Chrome Web Store / Firefox Add-ons (store review is manual, outside v0.1).',
    hasBackend: false,
  },
  'desktop': {
    frontend: 'Tauri v2 (Rust shell) + Vite/TypeScript webview UI',
    backend: 'Rust core in `src-tauri/` exposed through Tauri commands (IPC); Supabase optional for accounts / sync',
    deploySteps:
      'Run `npm run quality` (typecheck + web build + `cargo check`), then `npm run bundle` to produce the '
      + 'platform installer. Code signing, notarization and store/update distribution stay manual (outside v0.1).',
    hasBackend: false,
  },
  'mobile': {
    frontend: 'Mobile app (Expo/React Native)',
    backend: 'Optional; defaults to None',
    deploySteps: 'Build the mobile bundle and submit to the app store.',
    hasBackend: false,
  },
  'api-tool': {
    frontend: 'None (API-first)',
    backend: 'Hono on Vercel Functions',
    deploySteps: 'Deploy the Vercel API Preview.',
    hasBackend: true,
  },
};

function markdown(value: string) {
  return value.replaceAll('```', "'''");
}

function yamlQuoted(value: string) {
  return JSON.stringify(value);
}

function analyticsVariables(blueprint: ProductBlueprint) {
  return blueprint.spec.analytics.providers.flatMap(provider => {
    if (provider === 'ga4') {
      return [{
        name: 'VITE_GA4_MEASUREMENT_ID',
        classification: 'public',
        source: 'manual Google Analytics property selection',
        targets: 'cloudflare-pages',
        validation: 'Verify the GA4 script loads only after privacy approval.',
      }];
    }
    return [{
      name: 'VITE_CLARITY_PROJECT_ID',
      classification: 'public',
      source: 'manual Microsoft Clarity project selection',
      targets: 'cloudflare-pages',
      validation: 'Verify the Clarity script loads only after privacy approval.',
    }];
  });
}

function environmentContract(blueprint: ProductBlueprint) {
  const desc = PRODUCT_TYPE_DESCRIPTORS[blueprint.spec.product.type];
  const backendVariables = desc?.hasBackend
    ? [
        {
          name: 'VITE_API_BASE_URL',
          classification: 'public' as const,
          source: 'derived Vercel deployment URL',
          targets: 'cloudflare-pages',
          validation: 'Health-check the deployed API URL before the frontend build.',
        },
        {
          name: 'VITE_SUPABASE_URL',
          classification: 'managed' as const,
          source: 'Supabase project output',
          targets: 'cloudflare-pages',
          validation: 'Verify the value is a HTTPS Supabase project URL.',
        },
        {
          name: 'VITE_SUPABASE_ANON_KEY',
          classification: 'public' as const,
          source: 'Supabase project output',
          targets: 'cloudflare-pages',
          validation: 'Verify it is an anon/publishable key, never a service role key.',
        },
        {
          name: 'SUPABASE_SERVICE_ROLE_KEY',
          classification: 'secret' as const,
          source: 'Supabase secret reference',
          targets: 'vercel-functions',
          validation: 'Verify the key is absent from browser builds, Markdown and logs.',
        },
        {
          name: 'ALLOWED_ORIGINS',
          classification: 'derived' as const,
          source: 'Cloudflare Pages deployment URL',
          targets: 'vercel-functions',
          validation: 'Run a cross-origin API smoke test from the Pages preview URL.',
        },
      ]
    : [];
  const variables = [
    ...backendVariables,
    ...analyticsVariables(blueprint),
  ];

  const body = variables.map(variable => [
    `  - name: ${variable.name}`,
    `    classification: ${variable.classification}`,
    `    source: ${yamlQuoted(variable.source)}`,
    '    environments: [preview, dev, production]',
    `    targets: [${variable.targets}]`,
    `    validation: ${yamlQuoted(variable.validation)}`,
  ].join('\n')).join('\n');
  return `# Generated from ProductBlueprint revision ${blueprint.metadata.revision}. Do not store secret values here.\nvariables:\n${body}\n`;
}

export function getManualActions(blueprint: ProductBlueprint): ManualAction[] {
  const actions: ManualAction[] = [
    {
      id: 'authorize-github',
      title: 'Authorize GitHub access',
      reason: 'Repository ownership and protected-branch permissions belong to you.',
      steps: ['Confirm the intended GitHub account or organization.', 'Grant only repository, pull request and checks permissions.', 'Return to Agent-Dev for a read-only capability check.'],
      verification: 'Agent-Dev can read the selected account and list its permitted repositories.',
    },
    {
      id: 'authorize-supabase',
      title: 'Authorize Supabase and choose an organization',
      reason: 'Database region, plan and project ownership can affect cost and compliance.',
      steps: ['Sign in to Supabase.', 'Choose the organization and region.', 'Review the project plan before any project is created.'],
      verification: 'Agent-Dev can discover the chosen organization without reading database data.',
    },
    {
      id: 'authorize-cloudflare',
      title: 'Authorize Cloudflare Pages',
      reason: 'Pages deployment remains in your Cloudflare account.',
      steps: ['Sign in to Cloudflare.', 'Choose the account that owns the Pages project.', 'Approve Pages-only access; do not grant DNS access unless a custom domain is planned.'],
      verification: 'Agent-Dev can list Pages capabilities for the selected account.',
    },
    {
      id: 'authorize-vercel',
      title: 'Authorize Vercel Functions',
      reason: 'API deployment and server-side environment variables remain in your Vercel team.',
      steps: ['Sign in to Vercel.', 'Choose the team for the API project.', 'Review the required server-side environment variable targets.'],
      verification: 'Agent-Dev can discover the selected team and its deployment capabilities.',
    },
  ];

  if (blueprint.spec.product.dataSensitivity === 'sensitive') {
    actions.unshift({
      id: 'privacy-review',
      title: 'Approve the sensitive-data boundary',
      reason: 'Sensitive product data requires an explicit privacy, retention and access review.',
      steps: ['Define what sensitive data is collected.', 'Confirm who can access it and how long it is retained.', 'Approve the privacy notice and incident contact.'],
      verification: 'The approved policy is recorded before provisioning begins.',
    });
  }

  for (const provider of blueprint.spec.analytics.providers) {
    actions.push({
      id: `configure-${provider}`,
      title: `Configure ${provider === 'ga4' ? 'Google Analytics 4' : 'Microsoft Clarity'}`,
      reason: 'Analytics changes the privacy boundary and requires an account-owned identifier.',
      steps: ['Confirm tracking is permitted for this product.', 'Create or select the analytics property.', 'Provide only the public measurement or project ID.'],
      verification: 'The public identifier is present in the environment contract and the client script is observable after consent.',
    });
  }

  if (blueprint.metadata.customInstructions) {
    actions.push({
      id: 'custom-instruction',
      title: 'Resolve the custom implementation note',
      reason: 'The note is preserved but is not backed by an automation module yet.',
      steps: ['Review the requested note.', 'Decide whether it requires a supported module or a project-specific ADR.', 'Approve its acceptance criteria before implementation.'],
      verification: 'A linked implementation task or ADR records the resolution.',
    });
  }
  return actions;
}

// Governance artifacts are shared across product types: the Blueprint, Policy, Quality Gate and
// release boundary are identical regardless of the delivered artifact shape. Only the Delivery
// baseline and deploy step strings differ per type, drawn from PRODUCT_TYPE_DESCRIPTORS.
function buildGovernanceArtifacts(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const desc = PRODUCT_TYPE_DESCRIPTORS[blueprint.spec.product.type] ?? PRODUCT_TYPE_DESCRIPTORS['web-saas'];
  const intent = markdown(blueprint.metadata.productIntent || 'Not specified yet.');
  const analytics = blueprint.spec.analytics.providers.length === 0 ? 'None' : blueprint.spec.analytics.providers.join(', ').toUpperCase();
  const quality = blueprint.spec.quality.required.join(', ');
  const header = `> Generated from ProductBlueprint revision ${blueprint.metadata.revision}. Do not edit this file directly.\n\n`;
  return [
    {
      id: 'product-standard',
      title: 'Product Standard',
      path: 'generated/PRODUCT_STANDARD.md',
      content: `${header}# ${markdown(blueprint.metadata.name)} Product Standard\n\n## Product intent\n${intent}\n\n## Delivery baseline\n- Frontend: ${desc.frontend}\n- Backend: ${desc.backend}\n- Data and auth: ${desc.hasBackend ? 'Supabase' : 'Not provisioned for this product type'}\n- Source control: GitHub pull requests from ${blueprint.spec.sourceControl.integrationBranch} to ${blueprint.spec.sourceControl.productionBranch}\n- Preview: ${blueprint.spec.deployment.previewStrategy}\n- Analytics: ${analytics}\n\n## Quality contract\nRequired before preview: ${quality}.\n\n## Approval boundary\nProduction release, secret changes and sensitive-data changes require human approval.\n`,
    },
    {
      id: 'agent-instructions',
      title: 'Agent Instructions',
      path: 'generated/AGENTS.md',
      content: `${header}# Agent Execution Constraints\n\n- Work only from an approved specification and acceptance criteria.\n- Never read, print or commit secret values.\n- Keep work on a feature branch and use pull requests for integration.\n- Run ${quality} before reporting a task as ready.\n- Do not deploy to production, alter DNS or change data policy without an explicit human approval.\n- Treat this Blueprint revision as the governing source for delivery decisions.\n`,
    },
    {
      id: 'delivery-workflow',
      title: 'Delivery Workflow',
      path: 'generated/DELIVERY_WORKFLOW.md',
      content: `${header}# Delivery Workflow\n\n1. Clarify feature scope and acceptance criteria.\n2. Create an isolated feature branch and worktree.\n3. Implement with the approved Agent instructions.\n4.  Run ${quality}.\n5. Create a pull request to ${blueprint.spec.sourceControl.integrationBranch}.\n6. ${desc.deploySteps}\n7. Run the joint smoke test and request human preview approval.\n8. Open a release PR to ${blueprint.spec.sourceControl.productionBranch}; production deployment requires approval.\n9. Generate a delivery report with evidence and residual risks.\n`,
    },
    {
      id: 'environment-contract',
      title: 'Environment Contract',
      path: 'config/env.contract.yaml',
      content: environmentContract(blueprint),
    },
    {
      id: 'delivery-handoff',
      title: 'Delivery Handoff',
      path: 'generated/DELIVERY_HANDOFF.md',
      content: `${header}# ${markdown(blueprint.metadata.name)} Handoff\n\n## Current state\n- Blueprint revision: ${blueprint.metadata.revision}\n- Delivery state: needs input\n- External resources: not created by this plan\n\n## Next owner actions\n${getManualActions(blueprint).map((action, index) => `${index + 1}. ${action.title}: ${action.reason}`).join('\n')}\n\n## Known boundaries\nProvider authorization, resource provisioning, production release and secret handling remain outside this dry run.\n`,
    },
  ];
}

// Every check named in spec.quality.required has to be a real script in the generated package.json,
// otherwise `npm run quality` dies mid-run ("Missing script") and the product's CI can never go green.
function qualityScript(blueprint: ProductBlueprint): string {
  return blueprint.spec.quality.required.map(check => `npm run ${check}`).join(' && ');
}

function buildWebSaaS(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const templateHeader = `Generated from ProductBlueprint revision ${blueprint.metadata.revision}.`;
  const templatePackageName = blueprint.metadata.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-dev-product';
  return [
    { id: 'template-root-package', title: 'Web SaaS workspace package', path: 'package.json', content: JSON.stringify({ name: templatePackageName, private: true, type: 'module', packageManager: 'npm@10.8.2', scripts: { dev: 'concurrently -k "npm run dev -w web" "npm run dev -w api"', lint: 'eslint .', typecheck: 'tsc --noEmit', unit: 'vitest run', build: 'npm run build -w web', smoke: 'node scripts/smoke.mjs', quality: qualityScript(blueprint) }, workspaces: ['apps/web', 'apps/api'], devDependencies: { '@eslint/js': '^9.26.0', '@types/node': '^22.15.3', '@types/react': '^19.1.2', '@types/react-dom': '^19.1.2', '@vitejs/plugin-react': '^4.4.1', concurrently: '^9.1.0', eslint: '^9.26.0', globals: '^16.0.0', typescript: '^5.8.3', 'typescript-eslint': '^8.32.0', vite: '^7.3.6', vitest: '^3.1.3' } }, null, 2) + '\n' },
    // `vite/client` is required, not cosmetic: the web entrypoint reads `import.meta.env`, so
    // without it the generated baseline cannot pass its own typecheck.
    { id: 'template-root-tsconfig', title: 'Web SaaS TypeScript configuration', path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: ['node', 'vite/client'] }, include: ['apps/web/src', 'apps/api/src', 'vite.config.ts', 'eslint.config.js'] }, null, 2) + '\n' },
    { id: 'template-eslint-config', title: 'ESLint flat configuration', path: 'eslint.config.js', content: `import eslint from '@eslint/js';\nimport globals from 'globals';\nimport tseslint from 'typescript-eslint';\n\nexport default tseslint.config(\n  { ignores: ['**/dist/**', '**/node_modules/**'] },\n  eslint.configs.recommended,\n  ...tseslint.configs.recommended,\n  // typescript-eslint disables no-undef for TypeScript, but plain .mjs tooling scripts still need\n  // the Node globals declared or \`console\` and \`process\` are reported as undefined.\n  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },\n);\n` },
    { id: 'template-smoke-script', title: 'Post-build smoke check', path: 'scripts/smoke.mjs', content: `import { readFile } from 'node:fs/promises';\n\n// The deployed artifact is the built bundle, not the source. This asserts the build produced an\n// entry document and that it still carries the meta tag the API base URL is injected into.\nconst entry = 'apps/web/dist/index.html';\nconst html = await readFile(entry, 'utf8').catch(() => {\n  throw new Error('smoke: ' + entry + ' is missing. Run the build before the smoke check.');\n});\nif (!html.includes('name="api-base-url"')) {\n  throw new Error('smoke: ' + entry + ' lost the api-base-url meta tag, so the API URL cannot be injected.');\n}\nconsole.log('smoke: ' + entry + ' is present and injectable.');\n` },
    { id: 'template-vite-config', title: 'Vite React configuration', path: 'vite.config.ts', content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n` },
    { id: 'template-readme', title: 'Web SaaS template README', path: 'README.md', content: `# ${markdown(blueprint.metadata.name)}\n\n${templateHeader}\n\nThis is the Agent-Dev fixed Web SaaS Golden Path. The web app deploys to Cloudflare Pages and the Hono API deploys to Vercel Functions.\n\n## Local commands\n\n- \`npm install\` (first materialization; creates the lock file)\n- \`npm run quality\`\n- \`npm run dev\`\n\nCommit \`package-lock.json\` after the first install so CI can move to a locked install.\n\n## Environment\n\nUse \`config/env.contract.yaml\` as the source of truth. Never commit secret values.\n` },
    { id: 'template-web-package', title: 'Web application package', path: 'apps/web/package.json', content: JSON.stringify({ name: 'web', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, devDependencies: { '@vitejs/plugin-react': '^4.4.1', vite: '^7.3.6', typescript: '^5.8.3' } }, null, 2) + '\n' },
    { id: 'template-web-index', title: 'Vite web entry', path: 'apps/web/index.html', content: '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="api-base-url" content="%VITE_API_BASE_URL%" /><title>Agent-Dev Web SaaS</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n' },
    { id: 'template-web-main', title: 'Web application entrypoint', path: 'apps/web/src/main.tsx', content: `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './styles.css';\n\nconst apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';\n\nfunction App() {\n  const [apiStatus, setApiStatus] = React.useState('checking');\n  React.useEffect(() => {\n    if (!apiBaseUrl) return setApiStatus('not configured');\n    fetch(\`\${apiBaseUrl}/api/health\`)\n      .then(response => response.json())\n      .then(body => setApiStatus(body.status ?? 'unknown'))\n      .catch(() => setApiStatus('unreachable'));\n  }, []);\n  return <main><p className="eyebrow">Agent-Dev Web SaaS</p><h1>${markdown(blueprint.metadata.name)}</h1><p>${markdown(blueprint.metadata.productIntent || 'Your product baseline is ready for the next feature.')}</p><span className="status">API {apiBaseUrl || 'unset'} health: {apiStatus}</span></main>;\n}\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n` },
    { id: 'template-web-styles', title: 'Web application styles', path: 'apps/web/src/styles.css', content: ':root { font-family: Inter, system-ui, sans-serif; color: #1d2823; background: #f6f7f3; } body { margin: 0; min-width: 320px; } main { max-width: 720px; margin: 16vh auto; padding: 32px; } h1 { font-size: clamp(32px, 7vw, 64px); margin: 0 0 16px; } p { line-height: 1.6; } .eyebrow { color: #286b43; font-size: 12px; font-weight: 700; text-transform: uppercase; } .status { display: inline-block; margin-top: 20px; padding: 8px 10px; border-radius: 4px; color: #286b43; background: #e5f2e8; font-size: 13px; }\n' },
    { id: 'template-api-package', title: 'API application package', path: 'apps/api/package.json', content: JSON.stringify({ name: 'api', private: true, type: 'module', scripts: { dev: 'tsx src/index.ts' }, dependencies: { '@hono/node-server': '^1.14.1', hono: '^4.7.7' }, devDependencies: { tsx: '^4.19.3', typescript: '^5.8.3' } }, null, 2) + '\n' },
    { id: 'template-api-index', title: 'Hono API entrypoint', path: 'apps/api/src/index.ts', content: `import { serve } from '@hono/node-server';\nimport { Hono } from 'hono';\nimport { cors } from 'hono/cors';\nimport { handle } from 'hono/vercel';\n\nexport const app = new Hono();\n\napp.use('/api/*', cors({ origin: process.env.ALLOWED_ORIGIN ?? '*' }));\napp.get('/api/health', context => context.json({ service: '${markdown(blueprint.metadata.name)}', status: 'ok' }));\n\n// Vercel treats a default export as the legacy \`(req, res)\` signature and discards a returned\n// Response, so the fetch-style handler must be exported per HTTP method instead.\nconst handler = handle(app);\nexport const GET = handler;\nexport const POST = handler;\nexport const OPTIONS = handler;\n\nif (!process.env.VERCEL && !process.env.VITEST) serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });\n` },
    { id: 'template-api-test', title: 'API health unit test', path: 'apps/api/src/health.test.ts', content: `import { describe, expect, it } from 'vitest';\nimport { app } from './index.js';\n\ndescribe('health endpoint', () => {\n  it('reports the service by name so a deployment can be told apart from a stray one', async () => {\n    const response = await app.request('/api/health');\n    expect(response.status).toBe(200);\n    await expect(response.json()).resolves.toEqual({ service: '${markdown(blueprint.metadata.name)}', status: 'ok' });\n  });\n});\n` },
    { id: 'template-api-vercel', title: 'Vercel API configuration', path: 'apps/api/vercel.json', content: JSON.stringify({ version: 2, builds: [{ src: 'src/index.ts', use: '@vercel/node' }], routes: [{ src: '/api/(.*)', dest: '/src/index.ts' }] }, null, 2) + '\n' },
    { id: 'template-cloudflare', title: 'Cloudflare Pages configuration', path: 'wrangler.toml', content: `# ${templateHeader}\nname = "${blueprint.metadata.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-web"\ncompatibility_date = "2026-01-01"\npages_build_output_dir = "apps/web/dist"\n` },
    // Agent-Dev commits the agent's work with `git add -A`, and the provider CLIs drop their own
    // state into the workspace, so anything not listed here ends up in the product's first PR.
    // `node_modules` without a trailing slash: an agent may shortcut a test run with a symlink to
    // an existing dependency directory, and the directory-only pattern would let the link stage.
    { id: 'template-gitignore', title: 'Product git ignore rules', path: '.gitignore', content: 'node_modules\ndist/\n.env\n.env.*\n!.env.example\n.agent-dev/\n.vercel/\n.wrangler/\n' },
    // `cache: ''` on setup-node is required: the action defaults to dependency caching and fails
    // the whole job with "Dependencies lock file is not found" when the repository has no lock
    // file yet. The scaffold intentionally generates the lock file on first `npm install`, so the
    // first pull request must run without a lock file present.
    { id: 'template-quality-workflow', title: 'GitHub quality workflow', path: '.github/workflows/quality.yml', content: `name: quality\non:\n  pull_request:\n  push:\n    branches: [dev, main]\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          cache: ''\n      - run: npm install\n      - run: npm run quality\n` },
  ];
}

// Landing pages are a single static site: no backend workspace, no workspace package manager. It
// builds to Cloudflare Pages and the quality gate validates the static markup in-place (no browser).
function buildLandingPage(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const templateHeader = `Generated from ProductBlueprint revision ${blueprint.metadata.revision}.`;
  const safeName = blueprint.metadata.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-dev-landing';
  const layout = blueprint.metadata.customInstructions?.trim() || blueprint.metadata.productIntent || 'Your product, distilled to one page.';
  const analyticsSnippet = blueprint.spec.analytics.providers.map(provider =>
    provider === 'ga4'
      ? `    <!-- GA4: injected only after consent; value from %VITE_GA4_MEASUREMENT_ID% -->`
      : `    <!-- Clarity: injected only after consent; value from %VITE_CLARITY_PROJECT_ID% -->`
  ).join('\n');

  return [
    // Plain static site, no workspace tooling. `npm run build` copies src/ to dist/ and asserts the
    // markup carries a <main> landmark; `npm run quality` runs that build as the verification gate.
    { id: 'template-root-package', title: 'Landing page package', path: 'package.json', content: JSON.stringify({ name: safeName, private: true, type: 'module', scripts: { build: 'node scripts/build.mjs', lint: 'node scripts/build.mjs --check', quality: qualityScript(blueprint) } }, null, 2) + '\n' },
    { id: 'template-build-script', title: 'Static build / inject script', path: 'scripts/build.mjs', content: `import { mkdir, copyFile } from 'node:fs/promises';\n\n// Landing pages are static: this copies the src tree to dist and validates the entry document.\n// Analytics IDs are injected from the environment contract at deploy time, never committed.\nawait mkdir('dist', { recursive: true });\nfor (const file of ['index.html', 'styles.css', 'app.js']) {\n  await copyFile('src/' + file, 'dist/' + file).catch(() => {});\n}\nconst { readFile } = await import('node:fs/promises');\nconst html = await readFile('dist/index.html', 'utf8');\nif (!html.includes('<main')) throw new Error('build: index.html must contain a <main> landmark for SEO/a11y.');\nconsole.log('build: static site prepared at dist/');\n` },
    { id: 'template-readme', title: 'Landing page README', path: 'README.md', content: `# ${markdown(blueprint.metadata.name)}\n\n${templateHeader}\n\nThis is the Agent-Dev landing-page Golden Path. A single static site deploys to Cloudflare Pages.\n\n## Local commands\n\n- \`npm run build\` (prepare static output)\n- \`npm run quality\`\n\n## Environment\n\nUse \`config/env.contract.yaml\` as the source of truth. Never commit secret values.\n` },
    { id: 'template-index', title: 'Landing page entry', path: 'src/index.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="description" content="${markdown(layout)}" />\n    <title>${markdown(blueprint.metadata.name)}</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <main>\n      <p class="eyebrow">${markdown(blueprint.metadata.name)}</p>\n      <h1>${markdown(blueprint.metadata.name)}</h1>\n      <p class="subhead">${markdown(layout)}</p>\n      <a class="cta" href="#get-started">Get started</a>\n    </main>\n    ${analyticsSnippet}\n    <script src="app.js"></script>\n  </body>\n</html>\n` },
    {  id: 'template-styles', title: 'Landing page styles', path: 'src/styles.css', content: ':root { font-family: Inter, system-ui, sans-serif; color: #1d2823; background: #f6f7f3; } body { margin: 0; } main { max-width: 720px; margin: 18vh auto; padding: 32px; } h1 { font-size: clamp(36px, 8vw, 72px); margin: 0 0 16px; } .eyebrow { color: #286b43; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; } .subhead { font-size: 20px; line-height: 1.5; color: #4a5c52; } .cta { display: inline-block; margin-top: 24px; padding: 12px 20px; border-radius: 6px; background: #286b43; color: #fff; text-decoration: none; font-weight: 600; }\n' },
    { id: 'template-app-js', title: 'Landing page script', path: 'src/app.js', content: `// No framework needed for a landing page. Keep it dependency-free so it loads fast and scores well.\nconst params = new URLSearchParams(location.search);\ndocument.querySelectorAll('[data-param]').forEach(el => {\n  const key = el.getAttribute('data-param');\n  if (params.has(key)) el.textContent = params.get(key);\n});\n` },
    { id: 'template-cloudflare', title: 'Cloudflare Pages configuration', path: 'wrangler.toml', content: `# ${templateHeader}\nname = "${safeName}"\ncompatibility_date = "2026-01-01"\npages_build_output_dir = "dist"\n` },
    { id: 'template-forms-gitignore', title: 'Landing page git ignore rules', path: '.gitignore', content: 'node_modules\ndist/\n.env\n.env.*\n!.env.example\n.agent-dev/\n.wrangler/\n' },
    { id: 'template-quality-workflow', title: 'GitHub quality workflow', path: '.github/workflows/quality.yml', content: `name: quality\non:\n  pull_request:\n  push:\n    branches: [dev, main]\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          cache: ''\n      - run: npm install\n      - run: npm run quality\n` },
  ];
}

// Browser extensions (Manifest V3) are the next staged product type (multi-product-delivery-plan.md,
// Stage C). They ship a real, locally-buildable MV3 scaffold (Vite + @crxjs/vite-plugin) plus a
// web-store publishing handoff. They intentionally do NOT plug into the v0.1 Cloudflare/Vercel/
// Supabase cloud pipeline — store submission is a manual step outside Agent-Dev v0.1.
function buildBrowserExtension(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const productName = blueprint.metadata.name;
  const intent = blueprint.metadata.productIntent || 'No product intent provided.';
  const slug = productName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-dev-extension';

  return [
    { id: 'ext-manifest-config', title: 'Extension manifest (MV3)', path: 'manifest.config.ts', content: `import { defineManifest } from '@crxjs/vite-plugin';\n\nexport default defineManifest({\n  manifest_version: 3,\n  name: ${JSON.stringify(productName)},\n  version: '0.1.0',\n  description: ${JSON.stringify(intent)},\n  action: {\n    default_popup: 'popup.html',\n  },\n  // Store submission requires raster icons; add public/icons/icon128.png and reference it here.\n  background: {\n    service_worker: 'src/background.ts',\n  },\n  content_scripts: [\n    {\n      matches: ['<all_urls>'],\n      js: ['src/content.ts'],\n    },\n  ],\n  options_page: 'options.html',\n  permissions: ['storage', 'activeTab'],\n  host_permissions: ['<all_urls>'],\n});\n` },
    { id: 'ext-vite-config', title: 'Vite + crx config', path: 'vite.config.ts', content: `import { defineConfig } from 'vite';\nimport { crx } from '@crxjs/vite-plugin';\nimport manifest from './manifest.config';\n\nexport default defineConfig({\n  plugins: [crx({ manifest })],\n  build: {\n    outDir: 'dist',\n  },\n});\n` },
    { id: 'ext-package', title: 'Extension package', path: 'package.json', content: JSON.stringify({ name: slug, private: true, version: '0.1.0', type: 'module', scripts: { dev: 'vite', typecheck: 'tsc --noEmit', build: 'vite build', quality: qualityScript(blueprint), preview: 'vite preview' }, devDependencies: { '@crxjs/vite-plugin': '^2.0.0-beta.27', '@types/chrome': '^0.0.270', '@types/node': '^22.15.3', typescript: '^5.6.3', vite: '^5.4.10' } }, null, 2) + '\n' },
    { id: 'ext-tsconfig', title: 'Extension tsconfig', path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, resolveJsonModule: true, skipLibCheck: true, types: ['chrome', 'node'] }, include: ['src', 'manifest.config.ts', 'vite.config.ts'] }, null, 2) + '\n' },
    { id: 'ext-popup-html', title: 'Popup HTML', path: 'popup.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <link rel="stylesheet" href="src/popup.css" />\n    <title>${markdown(productName)}</title>\n  </head>\n  <body>\n    <main class="popup">\n      <h1>${markdown(productName)}</h1>\n      <p class="hint">Generated by Agent-Dev. Edit <code>src/popup.ts</code> to build your popup UI.</p>\n    </main>\n    <script type="module" src="/src/popup.ts"></script>\n  </body>\n</html>\n` },
    { id: 'ext-popup-ts', title: 'Popup entry', path: 'src/popup.ts', content: `const root = document.querySelector<HTMLElement>('.popup');\nif (root) {\n  // TODO: build your popup UI here.\n  console.log('[${productName}] popup loaded');\n}\n` },
    { id: 'ext-popup-css', title: 'Popup styles', path: 'src/popup.css', content: `:root { color-scheme: light dark; }\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n.popup { width: 320px; padding: 16px; }\n.popup h1 { font-size: 16px; margin: 0 0 8px; }\n.hint { color: #666; font-size: 13px; }\n` },
    { id: 'ext-options-html', title: 'Options HTML', path: 'options.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${markdown(productName)} — Options</title>\n  </head>\n  <body>\n    <main class="options">\n      <h1>${markdown(productName)} — Options</h1>\n      <p class="hint">Generated by Agent-Dev. Edit <code>src/options.ts</code> to persist settings (chrome.storage.local).</p>\n    </main>\n    <script type="module" src="/src/options.ts"></script>\n  </body>\n</html>\n` },
    { id: 'ext-options-ts', title: 'Options entry', path: 'src/options.ts', content: `// Options page entry point. Persist settings with chrome.storage.local.\nconsole.log('[${productName}] options loaded');\n` },
    { id: 'ext-background-ts', title: 'Background service worker', path: 'src/background.ts', content: `// MV3 background service worker — extension lifecycle and cross-tab messaging.\nchrome.runtime.onInstalled.addListener(() => {\n  console.log('[${productName}] installed');\n});\n` },
    { id: 'ext-content-ts', title: 'Content script', path: 'src/content.ts', content: `// Content script injected into matched pages.\nconsole.log('[${productName}] content script active on', window.location.href);\n` },
    { id: 'ext-readme', title: 'Extension README', path: 'README.md', content: `# ${markdown(productName)}\n\nBrowser extension (Manifest V3) generated by Agent-Dev.\n\n## Structure\n- \`manifest.config.ts\` — MV3 manifest (built into \`dist/manifest.json\`)\n- \`popup.html\` / \`src/popup.ts\` — toolbar popup UI\n- \`options.html\` / \`src/options.ts\` — options page\n- \`src/background.ts\` — service worker (lifecycle, messaging)\n- \`src/content.ts\` — content script injected into pages\n\n## Develop\n1. \`npm install\`\n2. \`npm run dev\` (Vite watch build to \`dist/\`)\n3. Open \`chrome://extensions\`, enable **Developer mode**, click **Load unpacked**, select \`dist/\`\n4. Edit source; click the extension's **Reload** to pick up changes\n\n## Build\n\`npm run build\` → \`dist/\`\n\n## Publish (manual, outside v0.1 pipeline)\n- Add raster icons (\`public/icons/icon128.png\` and friends) and reference them from \`manifest.config.ts\`; stores reject submissions without them.\n- Chrome: package \`dist/\`, submit to the Chrome Web Store (developer account + review required).\n- Firefox: port via \`webextension-polyfill\` and submit to Firefox Add-ons.\nStore submission and review are not automated by Agent-Dev v0.1.\n\n## Intent\n${markdown(intent)}\n` },
    { id: 'ext-gitignore', title: 'Extension git ignore rules', path: '.gitignore', content: 'node_modules\ndist/\n.env\n.env.*\n!.env.example\n.agent-dev/\n' },
    { id: 'ext-quality-workflow', title: 'GitHub quality workflow', path: '.github/workflows/quality.yml', content: `name: quality\non:\n  pull_request:\n  push:\n    branches: [dev, main]\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          cache: ''\n      - run: npm install\n      - run: npm run quality\n` },
  ];
}

function buildDesktop(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const productName = blueprint.metadata.name;
  const intent = blueprint.metadata.productIntent || 'No product intent provided.';
  const slug = productName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-dev-desktop';
  // Cargo package names may not start with a digit and are used as the Rust crate name.
  const crateName = (/^[0-9]/.test(slug) ? `app-${slug}` : slug).replaceAll('-', '_');

  return [
    { id: 'desktop-package', title: 'Desktop package', path: 'package.json', content: JSON.stringify({ name: slug, private: true, version: '0.1.0', type: 'module', scripts: { dev: 'tauri dev', 'dev:web': 'vite', typecheck: 'tsc --noEmit', build: 'vite build', 'rust-check': 'node scripts/ensure-icon.mjs && cargo check --manifest-path src-tauri/Cargo.toml', quality: qualityScript(blueprint), bundle: 'tauri build' }, devDependencies: { '@tauri-apps/cli': '^2.1.0', '@types/node': '^22.15.3', typescript: '^5.6.3', vite: '^5.4.10' }, dependencies: { '@tauri-apps/api': '^2.1.0' } }, null, 2) + '\n' },
    { id: 'desktop-tsconfig', title: 'Desktop tsconfig', path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, types: ['node'] }, include: ['src', 'vite.config.ts'] }, null, 2) + '\n' },
    { id: 'desktop-vite-config', title: 'Vite config', path: 'vite.config.ts', content: `import { defineConfig } from 'vite';\n\n// Tauri drives this dev server, so the port has to be fixed and failures must be loud.\nexport default defineConfig({\n  clearScreen: false,\n  server: {\n    port: 1420,\n    strictPort: true,\n  },\n  build: {\n    outDir: 'dist',\n    target: 'es2022',\n  },\n});\n` },
    { id: 'desktop-index-html', title: 'Webview HTML', path: 'index.html', content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <link rel="stylesheet" href="/src/styles.css" />\n    <title>${markdown(productName)}</title>\n  </head>\n  <body>\n    <main class="shell">\n      <h1>${markdown(productName)}</h1>\n      <p class="intent">${markdown(intent)}</p>\n      <p class="version">Rust core version: <strong data-version>loading…</strong></p>\n    </main>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n` },
    { id: 'desktop-main-ts', title: 'Webview entry', path: 'src/main.ts', content: `import { invoke } from '@tauri-apps/api/core';\n\n// Real IPC round trip to the Rust core, so a broken command surfaces immediately.\nconst target = document.querySelector<HTMLElement>('[data-version]');\n\ninvoke<string>('app_version')\n  .then(version => {\n    if (target) target.textContent = version;\n  })\n  .catch(error => {\n    if (target) target.textContent = 'unavailable';\n    console.error('[${productName}] app_version failed', error);\n  });\n` },
    { id: 'desktop-styles', title: 'Webview styles', path: 'src/styles.css', content: `:root { color-scheme: light dark; }\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n.shell { padding: 32px; max-width: 720px; }\n.shell h1 { font-size: 22px; margin: 0 0 12px; }\n.intent { color: #666; line-height: 1.6; }\n.version { margin-top: 24px; font-size: 14px; }\n` },
    { id: 'desktop-cargo-toml', title: 'Rust crate manifest', path: 'src-tauri/Cargo.toml', content: `[package]\nname = "${crateName}"\nversion = "0.1.0"\nedition = "2021"\nrust-version = "1.77"\n\n[lib]\nname = "${crateName}_lib"\npath = "src/lib.rs"\n\n[[bin]]\nname = "${crateName}"\npath = "src/main.rs"\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\n` },
    { id: 'desktop-build-rs', title: 'Rust build script', path: 'src-tauri/build.rs', content: 'fn main() {\n    tauri_build::build()\n}\n' },
    { id: 'desktop-lib-rs', title: 'Rust core', path: 'src-tauri/src/lib.rs', content: `#[tauri::command]\nfn app_version() -> String {\n    env!("CARGO_PKG_VERSION").to_string()\n}\n\npub fn run() {\n    tauri::Builder::default()\n        .invoke_handler(tauri::generate_handler![app_version])\n        .run(tauri::generate_context!())\n        .expect("failed to start ${productName}");\n}\n` },
    { id: 'desktop-main-rs', title: 'Rust entry point', path: 'src-tauri/src/main.rs', content: `// Keeps the extra console window from appearing in Windows release builds.\n#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    ${crateName}_lib::run()\n}\n` },
    { id: 'desktop-tauri-conf', title: 'Tauri config', path: 'src-tauri/tauri.conf.json', content: JSON.stringify({ $schema: 'https://schema.tauri.app/config/2', productName, version: '0.1.0', identifier: `io.agent-dev.${slug}`, build: { frontendDist: '../dist', devUrl: 'http://localhost:1420', beforeDevCommand: 'npm run dev:web', beforeBuildCommand: 'npm run build' }, app: { windows: [{ title: productName, width: 960, height: 640, resizable: true }], security: { csp: null } }, bundle: { active: true, targets: 'all', icon: ['icons/icon.png'] } }, null, 2) + '\n' },
    { id: 'desktop-icon-script', title: 'Placeholder icon generator', path: 'scripts/ensure-icon.mjs', content: "// Tauri's generate_context! macro fails to compile without src-tauri/icons/icon.png,\n// so this writes a plain placeholder when none exists. Replace it before shipping:\n// `npx tauri icon path/to/your-icon.png` generates the full platform icon set.\nimport { existsSync, mkdirSync, writeFileSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { deflateSync } from 'node:zlib';\n\nconst root = dirname(fileURLToPath(import.meta.url));\nconst target = join(root, '..', 'src-tauri', 'icons', 'icon.png');\nif (existsSync(target)) process.exit(0);\n\nconst size = 512;\nconst rgba = [0x1f, 0x2a, 0x44, 0xff];\nconst scanlines = Buffer.concat(\n  Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgba).flat())])),\n);\n\nconst crcTable = Array.from({ length: 256 }, (_, n) => {\n  let c = n;\n  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;\n  return c >>> 0;\n});\nfunction crc32(buffer) {\n  let c = 0xffffffff;\n  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);\n  return (c ^ 0xffffffff) >>> 0;\n}\nfunction chunk(type, data) {\n  const length = Buffer.alloc(4);\n  length.writeUInt32BE(data.length);\n  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);\n  const crc = Buffer.alloc(4);\n  crc.writeUInt32BE(crc32(body));\n  return Buffer.concat([length, body, crc]);\n}\n\nconst ihdr = Buffer.alloc(13);\nihdr.writeUInt32BE(size, 0);\nihdr.writeUInt32BE(size, 4);\nihdr[8] = 8; // bit depth\nihdr[9] = 6; // colour type RGBA\n\nmkdirSync(dirname(target), { recursive: true });\nwriteFileSync(target, Buffer.concat([\n  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),\n  chunk('IHDR', ihdr),\n  chunk('IDAT', deflateSync(scanlines)),\n  chunk('IEND', Buffer.alloc(0)),\n]));\nconsole.log('icon: wrote placeholder src-tauri/icons/icon.png (replace before packaging)');\n" },
    { id: 'desktop-gitignore', title: 'Desktop git ignore rules', path: '.gitignore', content: 'node_modules\ndist/\nsrc-tauri/target/\nsrc-tauri/gen/\n.env\n.env.*\n!.env.example\n.agent-dev/\n' },
    { id: 'desktop-readme', title: 'Desktop README', path: 'README.md', content: `# ${markdown(productName)}\n\nDesktop application (Tauri v2) generated by Agent-Dev.\n\n## Structure\n- \`index.html\` / \`src/main.ts\` — webview UI (Vite + TypeScript)\n- \`src-tauri/src/lib.rs\` — Rust core and Tauri commands (\`app_version\` is a working example)\n- \`src-tauri/tauri.conf.json\` — window, build and bundle configuration\n\n## Prerequisites\n- Node.js 22+\n- Rust toolchain (\`rustup\`), plus the platform webview prerequisites listed at https://tauri.app/start/prerequisites/\n\n## Develop\n1. \`npm install\`\n2. \`npm run dev\` — Tauri starts the Vite dev server and opens the native window\n\n## Quality gate\n\`npm run quality\` → ${blueprint.spec.quality.required.join(' → ')}\n\n\`rust-check\` runs \`cargo check\`, which needs the Rust toolchain on the machine and in CI.\n\n## Package (manual, outside v0.1 pipeline)\n- \`scripts/ensure-icon.mjs\` writes a plain placeholder \`src-tauri/icons/icon.png\` when none exists, because \`tauri::generate_context!\` cannot compile without one. Replace it with real artwork (\`npx tauri icon path/to/icon.png\` generates the full platform set) before packaging.\n- \`npm run bundle\` produces the installer for the OS you run it on; cross-OS installers need a matching runner.\n- macOS code signing + notarization (Apple Developer ID) and Windows code signing are manual and require certificates Agent-Dev never handles.\n- Auto-update distribution is not configured; wire up \`tauri-plugin-updater\` and your own release hosting if you need it.\n\n## Intent\n${markdown(intent)}\n` },
    { id: 'desktop-quality-workflow', title: 'GitHub quality workflow', path: '.github/workflows/quality.yml', content: `name: quality\non:\n  pull_request:\n  push:\n    branches: [dev, main]\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n          cache: ''\n      - uses: dtolnay/rust-toolchain@stable\n      - name: Install Linux webview dependencies\n        run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf\n      - run: npm install\n      - run: npm run quality\n` },
  ];
}

function notSupportedArtifact(blueprint: ProductBlueprint): GeneratedArtifact {
  const productType = blueprint.spec.product.type;
  const roadmapStage: Record<string, string> = {
    'mobile': 'Stage D (Expo/React Native)',
    'api-tool': 'Stage A-table (API-first tooling)',
  };
  return {
    id: 'delivery-handoff',
    title: `Product type ${productType} — not yet auto-generated`,
    path: 'generated/DELIVERY_HANDOFF.md',
    content: [
      `# ${productType} delivery — manual handoff`,
      '',
      `Product type: ${productType}`,
      '',
      `Agent-Dev currently generates \`web-saas\`, \`landing-page\`, \`browser-extension\` and \`desktop\` products. \`${productType}\` is part of the multi-product roadmap (${roadmapStage[productType] ?? 'later stage'}).`,
      '',
      '## What Agent-Dev will NOT generate',
      '- No frontend or backend scaffold for this type yet.',
      '- No deploy pipeline templates for this type yet.',
      '',
      '## What you should do',
      '1. Track the roadmap item for this product type.',
      '2. If you need this now, build the scaffold manually and connect it to the same Governance layer (Blueprint, Policy, Quality Gate, release).',
      '',
      '## Blueprint snapshot',
      `- Product intent: ${blueprint.metadata.productIntent || 'Not specified'}`,
      `- Data sensitivity: ${blueprint.spec.product.dataSensitivity}`,
      `- Runtime: ${blueprint.spec.runtime.provider}`,
      `- Analytics: ${blueprint.spec.analytics.providers.join(', ') || 'none'}`,
    ].join('\n'),
  };
}

export function generateArtifacts(blueprint: ProductBlueprint): GeneratedArtifact[] {
  switch (blueprint.spec.product.type) {
    case 'web-saas':
      return [...buildGovernanceArtifacts(blueprint), ...buildWebSaaS(blueprint)];
    case 'landing-page':
      return [...buildGovernanceArtifacts(blueprint), ...buildLandingPage(blueprint)];
    case 'browser-extension':
      return [...buildGovernanceArtifacts(blueprint), ...buildBrowserExtension(blueprint)];
    case 'desktop':
      return [...buildGovernanceArtifacts(blueprint), ...buildDesktop(blueprint)];
    default:
      // mobile / api-tool are enumerated for roadmap honesty but not yet backed by a
      // template engine (see multi-product-delivery-plan.md).
      return [notSupportedArtifact(blueprint)];
  }
}

export function createDryRunPlan(blueprint: ProductBlueprint): DryRunPlan {
  const artifacts = generateArtifacts(blueprint);
  return {
    blueprintRevision: blueprint.metadata.revision,
    noExternalChanges: true,
    summary: `This dry run prepares ${artifacts.length} generated artifacts and ${getManualActions(blueprint).length} manual actions. No cloud resource, credential or repository is changed.`,
    automaticPreparation: [
      'Validate the ProductBlueprint schema and selected module combination.',
      'Generate the product standard, agent constraints, delivery workflow, environment contract and handoff preview.',
      'Classify approval boundaries and manual actions before any provider plan is created.',
    ],
    manualActions: getManualActions(blueprint),
    artifacts,
  };
}

export function createBaselinePlan(blueprint: ProductBlueprint): BaselinePlan {
  const selections = [
    ['github-repository', 'GitHub repository', blueprint.spec.sourceControl.owner, 'Choose the GitHub owner or organization that will own the repository.'],
    ['supabase-project', 'Supabase project', blueprint.spec.data.organization, 'Choose the Supabase organization and later confirm region and plan.'],
    ['vercel-api', 'Vercel API project', blueprint.spec.deployment.api.team, 'Choose the Vercel team that will own the API project.'],
    ['cloudflare-pages', 'Cloudflare Pages project', blueprint.spec.deployment.web.account, 'Choose the Cloudflare account that will own the Pages project.'],
  ] as const;
  const resources: BaselinePlanResource[] = selections.map(([id, title, owner, missingReason]) => ({
    id,
    title,
    owner: owner || null,
    status: owner ? 'requires-approval' : 'blocked',
    reason: owner
      ? `After approval, Agent-Dev may create the ${title.toLowerCase()} in ${owner}.`
      : missingReason,
  }));
  const blocked = resources.filter(resource => resource.status === 'blocked');
  return {
    blueprintRevision: blueprint.metadata.revision,
    noExternalChanges: true,
    readyForApproval: blocked.length === 0,
    summary: blocked.length === 0
      ? 'All ownership targets are selected. Resource creation still requires one explicit approval and has not started.'
      : `${blocked.length} ownership target${blocked.length === 1 ? ' is' : 's are'} still required before a baseline can be approved.`,
    resources,
  };
}
