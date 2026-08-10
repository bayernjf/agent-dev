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

export function buildFinalDeliveryReport(projectName: string, evidence: {
  localApply: { status: string; workspacePath: string; attempts: number } | null;
  task: { title: string; status: string; acceptanceCriteria: string[] } | null;
  runtime: { status: string; mode: string; executionAllowed: boolean } | null;
  quality: { status: string; exitCode: number } | null;
  acceptance: { status: string; criteriaConfirmed: boolean; summary: string; approvedBy?: string } | null;
  git: { branch: string; head: string; status: string; diffStat: string } | null;
}) {
  const criteria = evidence.task?.acceptanceCriteria.map(item => `- ${item}`).join('\n') || '- No approved Feature Task.';
  return `# ${projectName} Final Delivery Report\n\n> Local-first evidence report. No external provider write is claimed.\n\n## Delivery status\n\n- Local Apply: ${evidence.localApply?.status ?? 'not-started'}\n- Feature Task: ${evidence.task?.status ?? 'not-created'}${evidence.task ? ` (${evidence.task.title})` : ''}\n- Runtime: ${evidence.runtime?.status ?? 'not-prepared'}${evidence.runtime ? ` / ${evidence.runtime.mode}` : ''}\n- Quality Gate: ${evidence.quality?.status ?? 'missing'}${evidence.quality ? ` (exit ${evidence.quality.exitCode})` : ''}\n- Acceptance: ${evidence.acceptance?.status ?? 'missing'}\n\n## Acceptance criteria\n\n${criteria}\n\n## Git evidence\n\n${evidence.git ? `- Branch: ${evidence.git.branch}\n- HEAD: ${evidence.git.head}\n- Working tree: ${evidence.git.status || 'clean'}\n- Diff: ${evidence.git.diffStat || 'no changes'}` : '- Git evidence unavailable.'}\n\n## Human acceptance\n\n${evidence.acceptance ? `- Criteria confirmed: ${evidence.acceptance.criteriaConfirmed}\n- Summary: ${evidence.acceptance.summary}\n- Approved by: ${evidence.acceptance.approvedBy ?? 'not approved'}` : 'No acceptance record submitted.'}\n\n## Boundary\n\nProduction deployment, real GitHub PR/Actions, Vercel, Cloudflare and Supabase writes remain outside this report until their provider-specific evidence and approvals exist.\n`;
}

export function buildRealProviderReport(projectName: string, plans: { providerId: string; idempotencyKey: string; resources: { spec: { id: string; owner: string }; action: string; reason: string }[] }[], verification: { providerId: string; verified: boolean; missing: string[]; mismatched: string[] }[]) {
  const planRows = plans.flatMap(plan => plan.resources.map(resource => `| ${plan.providerId} | ${resource.spec.id} | ${resource.action} | ${resource.spec.owner || 'auto-detect'} | ${resource.reason} |`)).join('\n');
  const verifyRows = verification.map(item => `| ${item.providerId} | ${item.verified ? 'verified' : 'not verified'} | ${item.missing.join(', ') || '-'} | ${item.mismatched.join(', ') || '-'} |`).join('\n');
  return `# ${projectName} Real Provider Report\n\n> Real CLI-based provider operations. GitHub, Vercel and Cloudflare use authenticated local CLIs. Supabase is manual.\n\n## Plan\n\n| Provider | Resource | Action | Owner | Reason |\n| --- | --- | --- | --- | --- |\n${planRows}\n\n## Verification\n\n| Provider | Status | Missing | Mismatched |\n| --- | --- | --- | --- |\n${verifyRows}\n\n## Boundary\n\nGitHub uses \`gh\` CLI, Vercel uses \`vercel\` CLI, Cloudflare uses \`npx wrangler\`. Supabase requires manual project creation through the dashboard. Production deployment requires additional approval beyond this report.\n`;
}
