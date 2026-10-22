import type {
  ProviderApplyResult,
  ProviderApproval,
  ProviderPlan,
  ProviderResourceSpecs,
  ProviderVerification,
} from '@agent-dev/provider-core';

/**
 * Release registry port (T-M5-02). The real registry drives github/vercel/
 * cloudflare; the fake registry keeps the same plan→apply→verify contract
 * without external credentials.
 */
export interface ReleaseRegistry {
  plan(projectId: string, specs: ProviderResourceSpecs): Promise<ProviderPlan[]>;
  apply(
    projectId: string,
    plans: ProviderPlan[],
    approval: ProviderApproval,
  ): Promise<ProviderApplyResult[]>;
  verify(projectId: string, specs: ProviderResourceSpecs): Promise<ProviderVerification[]>;
}

export interface ServiceReleaseDefinition {
  projectId: string;
  owner: string;
  /** Provider hosting preview + production deployments. */
  deployProvider: string;
}

/** Desired release resources for one service (source + preview + production). */
export function releaseResourceSpecs(def: ServiceReleaseDefinition): ProviderResourceSpecs {
  return {
    github: [
      { id: `${def.projectId}-source`, kind: 'repository', owner: def.owner },
    ],
    [def.deployProvider]: [
      { id: `${def.projectId}-preview`, kind: 'preview-deployment', owner: def.owner },
      { id: `${def.projectId}-production`, kind: 'production-deployment', owner: def.owner },
    ],
  };
}

export interface OnboardingEvidence {
  projectId: string;
  applied: ProviderApplyResult[];
  verification: ProviderVerification[];
  verified: boolean;
  onboardedAt: string;
}

/**
 * Onboard one service onto the agent-dev release flow:
 * Blueprint (desired resources) → plan → approved apply → verify.
 */
export async function onboardService(
  registry: ReleaseRegistry,
  def: ServiceReleaseDefinition,
): Promise<OnboardingEvidence> {
  const specs = releaseResourceSpecs(def);
  const plans = await registry.plan(def.projectId, specs);
  const approval: ProviderApproval = {
    id: `approval-${def.projectId}`,
    status: 'approved',
    approvedAt: new Date().toISOString(),
  };
  const applied = await registry.apply(def.projectId, plans, approval);
  const verification = await registry.verify(def.projectId, specs);
  return {
    projectId: def.projectId,
    applied,
    verification,
    verified: verification.every((v) => v.verified),
    onboardedAt: new Date().toISOString(),
  };
}

/**
 * M5 pilot services. commerce-os is Node (pilot deployProvider=vercel);
 * loom is Python/FastAPI and requires a cloud host (deployProvider=cloud).
 * The real deploy providers are switched on once external credentials land
 * (see Tier0-外部依赖清单); the fake registry exercises the flow now.
 */
export function pilotReleaseDefinitions(owner: string): ServiceReleaseDefinition[] {
  return [
    { projectId: 'commerce-os', owner, deployProvider: 'vercel' },
    { projectId: 'loom', owner, deployProvider: 'cloud' },
  ];
}
