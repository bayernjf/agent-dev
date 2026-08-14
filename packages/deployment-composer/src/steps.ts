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

export type PreviewEvidence = {
  projectName: string;
  previewBranch: string;
  apiBaseUrl: string;
  pagesUrl: string;
  pagesUrlSource: 'cli-output' | 'derived-fallback';
  corsOrigin: string;
  apiHealth: string;
  exactCors: string;
  pageContainsApiUrl: string;
  jointSmoke: string;
  completedAt: string;
};
