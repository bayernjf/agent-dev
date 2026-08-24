import type { BlueprintAnswers, ProductBlueprint } from '@agent-dev/blueprint';

export const APPROVER_STORAGE_KEY = 'agent-dev.approver';

export const defaultAnswers: BlueprintAnswers = {
  mode: 'beginner',
  productIntent: '',
  dataSensitivity: 'standard',
  previewStrategy: 'per-pull-request',
  analyticsProviders: [],
  runtimeProvider: 'local-codex',
  customInstructions: '',
  githubOwner: '',
  vercelTeam: '',
  cloudflareAccount: '',
  supabaseOrganization: '',
};

export function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function answersFromBlueprint(blueprint: ProductBlueprint): BlueprintAnswers {
  return {
    mode: blueprint.metadata.mode,
    productIntent: blueprint.metadata.productIntent,
    dataSensitivity: blueprint.spec.product.dataSensitivity,
    previewStrategy: blueprint.spec.deployment.previewStrategy,
    analyticsProviders: blueprint.spec.analytics.providers,
    runtimeProvider: blueprint.spec.runtime.provider,
    customInstructions: blueprint.metadata.customInstructions,
    githubOwner: blueprint.spec.sourceControl.owner,
    vercelTeam: blueprint.spec.deployment.api.team,
    cloudflareAccount: blueprint.spec.deployment.web.account,
    supabaseOrganization: blueprint.spec.data.organization,
  };
}

export function recordApprover(approver: string): string {
  const name = approver.trim();
  if (name) localStorage.setItem(APPROVER_STORAGE_KEY, name);
  return name;
}
