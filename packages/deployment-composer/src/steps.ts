export type PreviewStepId =
  | 'deploy-vercel-preview'
  | 'verify-api-health'
  | 'inject-api-url'
  | 'build-frontend'
  | 'deploy-cloudflare-preview'
  | 'verify-joint-smoke'
  | 'write-evidence';

export type PreviewStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PreviewStep = {
  id: PreviewStepId;
  title: string;
  status: PreviewStepStatus;
  detail?: string;
};

export type PreviewDeploymentResult = {
  status: 'completed' | 'failed' | 'cancelled';
  steps: PreviewStep[];
  apiBaseUrl?: string;
  pagesUrl?: string;
  pagesUrlSource?: 'cli-output' | 'derived-fallback';
  corsOrigin?: string;
  evidence?: Record<string, string>;
  cleanupRequired?: { vercel?: string; cloudflare?: string };
};

export type PreviewComposerOptions = {
  workspacePath: string;
  projectName: string;
  previewBranch: string;
  apiDirectory?: string;
  frontendDirectory?: string;
  frontendDistDirectory?: string;
};

// Each field holds what the verification step actually observed. Recording a verdict string
// instead would make the evidence file a restatement of the code path rather than evidence.
export type PreviewObservations = {
  apiHealth: { url: string; httpStatus: number; contentType: string };
  exactCors: { expectedOrigin: string; observedHeader: string };
  pageContainsApiUrl: { url: string; httpStatus: number; sourceBytes: number; matchedApiBaseUrl: string };
  jointSmoke: { apiHealthUrl: string; apiHttpStatus: number; observedCorsHeader: string };
};

export type PreviewEvidence = {
  projectName: string;
  previewBranch: string;
  apiBaseUrl: string;
  pagesUrl: string;
  pagesUrlSource: 'cli-output' | 'derived-fallback';
  corsOrigin: string;
  observations: PreviewObservations;
  completedAt: string;
};
