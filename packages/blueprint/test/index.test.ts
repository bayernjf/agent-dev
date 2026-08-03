import { describe, expect, it } from 'vitest';
import { createBlueprint, createDefaultBlueprint, getBlueprintDecisions, productBlueprintSchema } from '../src/index.js';

describe('ProductBlueprint', () => {
  it('creates the fixed v0.1 Web SaaS Golden Path', () => {
    const blueprint = createDefaultBlueprint('Receipt Desk');

    expect(blueprint.spec.deployment.web.provider).toBe('cloudflare-pages');
    expect(blueprint.spec.deployment.api.provider).toBe('vercel-functions');
    expect(productBlueprintSchema.parse(blueprint)).toEqual(blueprint);
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
});
