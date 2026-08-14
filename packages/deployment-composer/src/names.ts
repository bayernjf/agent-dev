export type PreviewProjectNames = {
  vercelProject: string;
  cloudflareProject: string;
};

export function previewProjectNames(projectName: string, previewBranch: string): PreviewProjectNames {
  return {
    vercelProject: `${projectName}-api-${previewBranch}`,
    cloudflareProject: `${projectName}-web-${previewBranch}`,
  };
}
