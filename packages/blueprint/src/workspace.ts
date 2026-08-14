// Exposed as the `@agent-dev/blueprint/workspace` subpath rather than through the package barrel:
// Studio imports the barrel in the browser, and re-exporting this module dragged `node:fs` into the
// Vite bundle and broke the build.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProductBlueprint } from './index.js';
import { generateArtifacts, type GeneratedArtifact } from './generate.js';

// Deployment configuration is owned by the generator: a coding agent implementing a feature has no
// legitimate reason to edit it, so any difference here means the workspace predates a generator fix.
// Application source is excluded on purpose — agent feature work is expected to change it, and
// flagging that as drift would make the check useless.
const DEPLOYMENT_CONFIG_ARTIFACT_IDS: ReadonlySet<GeneratedArtifact['id']> = new Set([
  'template-api-vercel',
  'template-cloudflare',
  'template-quality-workflow',
]);

export type WorkspaceArtifactVerification = {
  usable: boolean;
  /** Workspace root does not exist, or holds none of the generated artifacts. */
  workspaceMissing: boolean;
  /** Generated artifact paths absent from the workspace. */
  missing: string[];
  /** Deployment configuration paths whose content differs from the current generator output. */
  staleConfig: string[];
  reason?: string;
};

export async function verifyWorkspaceArtifacts(workspacePath: string, blueprint: ProductBlueprint): Promise<WorkspaceArtifactVerification> {
  const artifacts = generateArtifacts(blueprint);
  const missing: string[] = [];
  const staleConfig: string[] = [];

  for (const artifact of artifacts) {
    let actual: string;
    try {
      actual = await readFile(join(workspacePath, artifact.path), 'utf8');
    } catch {
      missing.push(artifact.path);
      continue;
    }
    if (DEPLOYMENT_CONFIG_ARTIFACT_IDS.has(artifact.id) && actual !== artifact.content) staleConfig.push(artifact.path);
  }

  const workspaceMissing = missing.length === artifacts.length;
  const base = { workspaceMissing, missing, staleConfig };

  if (workspaceMissing) {
    return { ...base, usable: false, reason: `Workspace ${workspacePath} holds none of the generated artifacts; re-run Apply before deploying.` };
  }
  if (missing.length > 0) {
    return { ...base, usable: false, reason: `Workspace is missing ${missing.length} generated artifact(s): ${missing.join(', ')}.` };
  }
  if (staleConfig.length > 0) {
    return { ...base, usable: false, reason: `Workspace was produced by an older generator; deployment configuration differs from the current template: ${staleConfig.join(', ')}.` };
  }
  return { ...base, usable: true };
}
