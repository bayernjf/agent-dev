import type { ProductBlueprint } from './index.js';

export type GeneratedArtifact = {
  id: 'product-standard' | 'agent-instructions' | 'delivery-workflow' | 'environment-contract' | 'delivery-handoff' | 'template-root-package' | 'template-root-tsconfig' | 'template-eslint-config' | 'template-smoke-script' | 'template-vite-config' | 'template-readme' | 'template-web-package' | 'template-web-index' | 'template-web-main' | 'template-web-styles' | 'template-api-package' | 'template-api-index' | 'template-api-test' | 'template-api-vercel' | 'template-cloudflare' | 'template-gitignore' | 'template-quality-workflow';
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
  const variables = [
    {
      name: 'VITE_API_BASE_URL',
      classification: 'public',
      source: 'derived Vercel deployment URL',
      targets: 'cloudflare-pages',
      validation: 'Health-check the deployed API URL before the frontend build.',
    },
    {
      name: 'VITE_SUPABASE_URL',
      classification: 'managed',
      source: 'Supabase project output',
      targets: 'cloudflare-pages',
      validation: 'Verify the value is a HTTPS Supabase project URL.',
    },
    {
      name: 'VITE_SUPABASE_ANON_KEY',
      classification: 'public',
      source: 'Supabase project output',
      targets: 'cloudflare-pages',
      validation: 'Verify it is an anon/publishable key, never a service role key.',
    },
    {
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      classification: 'secret',
      source: 'Supabase secret reference',
      targets: 'vercel-functions',
      validation: 'Verify the key is absent from browser builds, Markdown and logs.',
    },
    {
      name: 'ALLOWED_ORIGINS',
      classification: 'derived',
      source: 'Cloudflare Pages deployment URL',
      targets: 'vercel-functions',
      validation: 'Run a cross-origin API smoke test from the Pages preview URL.',
    },
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

export function generateArtifacts(blueprint: ProductBlueprint): GeneratedArtifact[] {
  const intent = markdown(blueprint.metadata.productIntent || 'Not specified yet.');
  const analytics = blueprint.spec.analytics.providers.length === 0 ? 'None' : blueprint.spec.analytics.providers.join(', ').toUpperCase();
  const quality = blueprint.spec.quality.required.join(', ');
  const header = `> Generated from ProductBlueprint revision ${blueprint.metadata.revision}. Do not edit this file directly.\n\n`;
  const artifacts: GeneratedArtifact[] = [
    {
      id: 'product-standard',
      title: 'Product Standard',
      path: 'generated/PRODUCT_STANDARD.md',
      content: `${header}# ${markdown(blueprint.metadata.name)} Product Standard\n\n## Product intent\n${intent}\n\n## Delivery baseline\n- Frontend: React/Vite on Cloudflare Pages\n- API: Hono on Vercel Functions\n- Data and auth: Supabase\n- Source control: GitHub pull requests from ${blueprint.spec.sourceControl.integrationBranch} to ${blueprint.spec.sourceControl.productionBranch}\n- Preview: ${blueprint.spec.deployment.previewStrategy}\n- Analytics: ${analytics}\n\n## Quality contract\nRequired before preview: ${quality}.\n\n## Approval boundary\nProduction release, secret changes and sensitive-data changes require human approval.\n`,
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
      content: `${header}# Delivery Workflow\n\n1. Clarify feature scope and acceptance criteria.\n2. Create an isolated feature branch and worktree.\n3. Implement with the approved Agent instructions.\n4. Run ${quality}.\n5. Create a pull request to ${blueprint.spec.sourceControl.integrationBranch}.\n6. Deploy the Vercel API Preview, then the Cloudflare Pages Preview.\n7. Run the joint smoke test and request human preview approval.\n8. Open a release PR to ${blueprint.spec.sourceControl.productionBranch}; production deployment requires approval.\n9. Generate a delivery report with evidence and residual risks.\n`,
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
  const templateHeader = `Generated from ProductBlueprint revision ${blueprint.metadata.revision}.`;
  const templatePackageName = blueprint.metadata.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-dev-product';
  artifacts.push(
    // Every check named in spec.quality.required has to be a script that really runs. A `quality`
    // script covering only a subset reports a passing gate while the unnamed checks never execute.
    { id: 'template-root-package', title: 'Web SaaS workspace package', path: 'package.json', content: JSON.stringify({ name: templatePackageName, private: true, type: 'module', packageManager: 'npm@10.8.2', scripts: { dev: 'concurrently -k "npm run dev -w web" "npm run dev -w api"', lint: 'eslint .', typecheck: 'tsc --noEmit', unit: 'vitest run', build: 'npm run build -w web', smoke: 'node scripts/smoke.mjs', quality: blueprint.spec.quality.required.map(check => `npm run ${check}`).join(' && ') }, workspaces: ['apps/web', 'apps/api'], devDependencies: { '@eslint/js': '^9.26.0', '@types/node': '^22.15.3', '@types/react': '^19.1.2', '@types/react-dom': '^19.1.2', '@vitejs/plugin-react': '^4.4.1', concurrently: '^9.1.0', eslint: '^9.26.0', globals: '^16.0.0', typescript: '^5.8.3', 'typescript-eslint': '^8.32.0', vite: '^7.3.6', vitest: '^3.1.3' } }, null, 2) + '\n' },
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
    { id: 'template-quality-workflow', title: 'GitHub quality workflow', path: '.github/workflows/quality.yml', content: `name: quality\non:\n  pull_request:\n  push:\n    branches: [dev, main]\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n      - run: npm install\n      - run: npm run quality\n` },
  );
  return artifacts;
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
