import { describe, expect, it } from 'vitest';
import { createDefaultBlueprint, productBlueprintSchema } from '../src/index.js';

describe('ProductBlueprint', () => {
  it('creates the fixed v0.1 Web SaaS Golden Path', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');

    expect(blueprint.spec.deployment.web.provider).toBe('cloudflare-pages');
    expect(blueprint.spec.deployment.api.provider).toBe('vercel-functions');
    expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
  });
});
