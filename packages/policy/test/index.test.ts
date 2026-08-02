import { describe, expect, it } from 'vitest';
import { decideAutomation } from '../src/index.js';

describe('policy', () => {
  it('requires a decision for production and secret work', () => {
    expect(decideAutomation('production').mode).toBe('ask');
    expect(decideAutomation('secret').mode).toBe('ask');
  });
});
