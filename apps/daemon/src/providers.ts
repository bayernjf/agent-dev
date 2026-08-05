import type { ProductBlueprint } from '@agent-dev/blueprint';
import type { ProviderResourceSpecs } from '@agent-dev/provider-core';

export function providerSpecsFromBlueprint(blueprint: ProductBlueprint): ProviderResourceSpecs {
  return {
    github: [{ id: 'github-repository', kind: 'repository', owner: blueprint.spec.sourceControl.owner }],
    supabase: [{ id: 'supabase-project', kind: 'database-auth-project', owner: blueprint.spec.data.organization }],
    vercel: [{ id: 'vercel-api', kind: 'functions-project', owner: blueprint.spec.deployment.api.team }],
    cloudflare: [{ id: 'cloudflare-pages', kind: 'pages-project', owner: blueprint.spec.deployment.web.account }],
  };
}
