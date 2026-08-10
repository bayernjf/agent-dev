import type { ProviderAdapter, ProviderPlan, ProviderState, ProviderVerification, ProviderDrift, ProviderApplyResult, ProviderApproval, ProviderResourceSpec } from '@agent-dev/provider-core';

export class ManualProviderAdapter implements ProviderAdapter {
  constructor(readonly providerId: string, private reason: string) {}

  async discover(): Promise<ProviderState> {
    return { providerId: this.providerId, resources: [] };
  }

  async plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan> {
    const resources = spec.map(resource => ({
      spec: resource,
      action: 'noop' as const,
      reason: this.reason,
    }));
    return {
      providerId: this.providerId,
      idempotencyKey: `${this.providerId}:manual:${resources.map(r => r.spec.id).join('|')}`,
      noExternalChanges: true,
      resources,
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    if (plan.providerId !== this.providerId) throw new Error('Provider plan does not match this adapter.');
    if (approval.status !== 'approved') throw new Error('Provider Apply requires an approved plan.');
    return { providerId: this.providerId, idempotencyKey: plan.idempotencyKey, applied: true, state: await this.discover() };
  }

  async verify(expected: ProviderResourceSpec[]): Promise<ProviderVerification> {
    return {
      providerId: this.providerId,
      verified: false,
      missing: expected.map(r => r.id),
      mismatched: [],
    };
  }

  async detectDrift(expected: ProviderResourceSpec[]): Promise<ProviderDrift[]> {
    return expected.map(resource => ({
      resourceId: resource.id,
      type: 'missing' as const,
      detail: this.reason,
    }));
  }
}
