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

// Production names carry no branch suffix: a product has exactly one production project pair,
// and a suffix would make every release create a new one.
export function productionProjectNames(projectName: string): PreviewProjectNames {
  return {
    vercelProject: `${projectName}-api`,
    cloudflareProject: `${projectName}-web`,
  };
}

// The Blueprint has no production domain field, so the production web origin is the Cloudflare
// Pages project apex. Deriving it here keeps the API's ALLOWED_ORIGIN and the verified URL equal
// by construction.
export function productionWebOrigin(projectName: string): string {
  return `https://${productionProjectNames(projectName).cloudflareProject}.pages.dev`;
}
