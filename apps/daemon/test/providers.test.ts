import { describe, expect, it } from 'vitest';
import { createBlueprint } from '@agent-dev/blueprint';
import { providerSpecsFromBlueprint } from '../src/providers.js';

describe('providerSpecsFromBlueprint', () => {
  it('plans every Golden Path provider for web-app', () => {
    const specs = providerSpecsFromBlueprint(createBlueprint('Receipt Desk', {
      githubOwner: 'acme', supabaseOrganization: 'acme', vercelTeam: 'acme', cloudflareAccount: 'acme',
    }));
    expect(Object.keys(specs).sort()).toEqual(['cloudflare', 'github', 'supabase', 'vercel']);
  });

  // Keys must be absent rather than empty: the registry reads `resources[0]` for every key it finds,
  // so an empty array would hand `undefined` to an adapter instead of simply not being planned.
  it('omits the providers a product type never uses', () => {
    const apiTool = providerSpecsFromBlueprint(createBlueprint('MCP Word Tools', { productType: 'api-tool', githubOwner: 'acme' }));
    expect(Object.keys(apiTool)).toEqual(['github']);

    const landing = providerSpecsFromBlueprint(createBlueprint('Launch Site', { productType: 'landing-page', githubOwner: 'acme', cloudflareAccount: 'acme' }));
    expect(Object.keys(landing).sort()).toEqual(['cloudflare', 'github']);
  });
});
