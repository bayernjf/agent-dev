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

export function buildProviderSimulationReport(projectName: string, plans: { providerId: string; idempotencyKey: string; resources: { spec: { id: string; owner: string }; action: string }[] }[], verification: { providerId: string; verified: boolean; missing: string[]; mismatched: string[] }[]) {
  const planRows = plans.flatMap(plan => plan.resources.map(resource => `| ${plan.providerId} | ${resource.spec.id} | ${resource.action} | ${resource.spec.owner || 'not selected'} |`)).join('\n');
  const verifyRows = verification.map(item => `| ${item.providerId} | ${item.verified ? 'verified' : 'not verified'} | ${item.missing.join(', ') || '-'} | ${item.mismatched.join(', ') || '-'} |`).join('\n');
  return `# ${projectName} Provider Simulation Report\n\n> Simulation only. No provider API or CLI was called.\n\n## Plan\n\n| Provider | Resource | Action | Owner |\n| --- | --- | --- | --- |\n${planRows}\n\n## Verification\n\n| Provider | Status | Missing | Drift |\n| --- | --- | --- | --- |\n${verifyRows}\n\n## Boundary\n\nThe Fake Provider state is in-memory and is discarded when the daemon exits. A real Apply requires a provider-specific approval, idempotency key, external read-back verification and rollback plan.\n`;
}

export function buildUnifiedDeliveryReport(projectName: string, localApply: { status: string; attempts: number; workspacePath: string; steps: { title: string; status: string; detail?: string }[] } | null, providerReport: string) {
  const localRows = localApply?.steps.map(step => `| ${step.title} | ${step.status} | ${step.detail ?? ''} |`).join('\n') || '| Local Apply | not started | No local Apply run exists for this revision. |';
  return `# ${projectName} Delivery Report\n\n> Local-first report. Provider state is simulated in memory; no external API or CLI was called.\n\n## Local Apply\n\n- Status: ${localApply?.status ?? 'not-started'}\n- Attempts: ${localApply?.attempts ?? 0}\n- Workspace: ${localApply?.workspacePath ?? 'not created'}\n\n| Step | Result | Detail |\n| --- | --- | --- |\n${localRows}\n\n## Provider Simulation\n\n${providerReport.replace(/^# .*\n\n/, '')}\n\n## Delivery boundary\n\nA real Provider Apply remains unimplemented. Before any external write, Agent-Dev must add provider-specific credentials, idempotency, read-back verification, approval evidence and rollback instructions.\n`;
}
