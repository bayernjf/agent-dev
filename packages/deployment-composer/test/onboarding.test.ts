import { describe, it, expect } from 'vitest';
import { FakeProviderRegistry } from '@agent-dev/provider-core';
import {
  onboardService,
  pilotReleaseDefinitions,
  releaseResourceSpecs,
} from '../src/onboarding.js';

describe('service release onboarding (T-M5-02)', () => {
  it('onboards both pilot services through Blueprint→plan→apply→verify', async () => {
    const registry = new FakeProviderRegistry();
    for (const def of pilotReleaseDefinitions('bayernjf')) {
      const evidence = await onboardService(registry, def);
      expect(evidence.applied.every((a) => a.applied)).toBe(true);
      expect(evidence.verified).toBe(true);
      // No missing or mismatched resources after apply.
      expect(evidence.verification.flatMap((v) => v.missing)).toEqual([]);
      expect(evidence.verification.flatMap((v) => v.mismatched)).toEqual([]);
    }
  });

  it('declares source + preview + production resources for commerce-os', () => {
    const [commerce] = pilotReleaseDefinitions('bayernjf');
    const specs = releaseResourceSpecs(commerce);
    expect(specs.github).toHaveLength(1);
    expect(specs.vercel.map((r) => r.kind).sort()).toEqual(
      ['preview-deployment', 'production-deployment'],
    );
  });

  it('declares a cloud-host target for loom (Python/FastAPI)', () => {
    const [, loom] = pilotReleaseDefinitions('bayernjf');
    const specs = releaseResourceSpecs(loom);
    expect(specs.github).toHaveLength(1);
    expect(specs.cloud).toHaveLength(2);
    expect(specs.cloud.map((r) => r.owner).every((o) => o === 'bayernjf')).toBe(true);
  });
});
