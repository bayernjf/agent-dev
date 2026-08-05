export type ProviderResourceSpec = {
  id: string;
  kind: string;
  owner: string;
};

export type ProviderResourceState = ProviderResourceSpec & {
  createdAt: string;
};

export type ProviderState = {
  providerId: string;
  resources: ProviderResourceState[];
};

export type ProviderPlanAction = 'create' | 'update' | 'noop';

export type ProviderPlanResource = {
  spec: ProviderResourceSpec;
  action: ProviderPlanAction;
  reason: string;
};

export type ProviderPlan = {
  providerId: string;
  idempotencyKey: string;
  noExternalChanges: true;
  resources: ProviderPlanResource[];
};

export type ProviderApproval = {
  id: string;
  status: 'approved';
  approvedAt: string;
};

export type ProviderApplyResult = {
  providerId: string;
  idempotencyKey: string;
  applied: true;
  state: ProviderState;
};

export type ProviderVerification = {
  providerId: string;
  verified: boolean;
  missing: string[];
  mismatched: string[];
};

export type ProviderDrift = {
  resourceId: string;
  type: 'missing' | 'owner-mismatch';
  detail: string;
};

export interface ProviderAdapter {
  discover(): Promise<ProviderState>;
  plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan>;
  apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult>;
  verify(expected: ProviderResourceSpec[]): Promise<ProviderVerification>;
  detectDrift(expected: ProviderResourceSpec[]): Promise<ProviderDrift[]>;
}

export class FakeProviderAdapter implements ProviderAdapter {
  private readonly resources = new Map<string, ProviderResourceState>();

  constructor(readonly providerId: string) {}

  async discover(): Promise<ProviderState> {
    return { providerId: this.providerId, resources: [...this.resources.values()].map(resource => ({ ...resource })) };
  }

  async plan(spec: ProviderResourceSpec[], current?: ProviderState): Promise<ProviderPlan> {
    const discovered = current ?? await this.discover();
    const resources = spec.map(resource => {
      const existing = discovered.resources.find(candidate => candidate.id === resource.id);
      if (!existing) return { spec: resource, action: 'create' as const, reason: 'Resource is not present in the discovered state.' };
      if (existing.owner !== resource.owner || existing.kind !== resource.kind) return { spec: resource, action: 'update' as const, reason: 'Discovered resource differs from the desired specification.' };
      return { spec: resource, action: 'noop' as const, reason: 'Discovered resource already matches the desired specification.' };
    });
    return {
      providerId: this.providerId,
      idempotencyKey: `${this.providerId}:${resources.map(resource => `${resource.spec.id}:${resource.action}`).join('|')}`,
      noExternalChanges: true,
      resources,
    };
  }

  async apply(plan: ProviderPlan, approval: ProviderApproval): Promise<ProviderApplyResult> {
    if (plan.providerId !== this.providerId) throw new Error('Provider plan does not match this adapter.');
    if (approval.status !== 'approved') throw new Error('Provider Apply requires an approved plan.');
    for (const resource of plan.resources) {
      if (resource.action === 'noop') continue;
      this.resources.set(resource.spec.id, { ...resource.spec, createdAt: new Date().toISOString() });
    }
    return { providerId: this.providerId, idempotencyKey: plan.idempotencyKey, applied: true, state: await this.discover() };
  }

  async verify(expected: ProviderResourceSpec[]): Promise<ProviderVerification> {
    const actual = await this.discover();
    const missing = expected.filter(resource => !actual.resources.some(candidate => candidate.id === resource.id)).map(resource => resource.id);
    const mismatched = expected.filter(resource => {
      const candidate = actual.resources.find(item => item.id === resource.id);
      return Boolean(candidate && (candidate.owner !== resource.owner || candidate.kind !== resource.kind));
    }).map(resource => resource.id);
    return { providerId: this.providerId, verified: missing.length === 0 && mismatched.length === 0, missing, mismatched };
  }

  async detectDrift(expected: ProviderResourceSpec[]): Promise<ProviderDrift[]> {
    const actual = await this.discover();
    const drift: ProviderDrift[] = [];
    for (const resource of expected) {
      const candidate = actual.resources.find(item => item.id === resource.id);
      if (!candidate) drift.push({ resourceId: resource.id, type: 'missing', detail: 'Resource is absent from discovered state.' });
      else if (candidate.owner !== resource.owner) drift.push({ resourceId: resource.id, type: 'owner-mismatch', detail: `Expected owner ${resource.owner}, found ${candidate.owner}.` });
    }
    return drift;
  }
}

export type ProviderResourceSpecs = Record<string, ProviderResourceSpec[]>;

export class FakeProviderRegistry {
  private readonly adapters = new Map<string, FakeProviderAdapter>();

  private adapter(projectId: string, providerId: string) {
    const key = `${projectId}:${providerId}`;
    const existing = this.adapters.get(key);
    if (existing) return existing;
    const created = new FakeProviderAdapter(providerId);
    this.adapters.set(key, created);
    return created;
  }

  async plan(projectId: string, specs: ProviderResourceSpecs) {
    return Promise.all(Object.entries(specs).map(async ([providerId, resources]) => this.adapter(projectId, providerId).plan(resources)));
  }

  async apply(projectId: string, plans: ProviderPlan[], approval: ProviderApproval) {
    return Promise.all(plans.map(plan => this.adapter(projectId, plan.providerId).apply(plan, approval)));
  }

  async verify(projectId: string, specs: ProviderResourceSpecs) {
    return Promise.all(Object.entries(specs).map(async ([providerId, resources]) => this.adapter(projectId, providerId).verify(resources)));
  }
}
