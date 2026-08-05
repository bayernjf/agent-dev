import type { ProductBlueprint } from './index.js';

export type GeneratedArtifact = {
  id: 'product-standard' | 'agent-instructions' | 'delivery-workflow' | 'environment-contract' | 'delivery-handoff';
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
  return [
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
