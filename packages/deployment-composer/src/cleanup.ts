import type { CommandRunner } from '@agent-dev/provider-cli';
import { providerCredentialEnv } from '@agent-dev/provider-cli';

export type CleanupResult = {
  vercel: boolean;
  cloudflare: boolean;
  errors: { provider: string; project: string; detail: string }[];
};

export async function cleanupPreviewProjects(
  runner: CommandRunner,
  options: { vercelProject?: string; cloudflareProject?: string; workspacePath: string },
): Promise<CleanupResult> {
  const errors: CleanupResult['errors'] = [];
  let vercelDeleted = true;
  let cloudflareDeleted = true;
  const env = providerCredentialEnv();

  if (options.cloudflareProject) {
    const result = await runner('npx', ['wrangler', 'pages', 'project', 'delete', options.cloudflareProject, '--yes'], {
      cwd: options.workspacePath,
      timeout: 60_000,
      env,
    });
    if (!result.success) {
      cloudflareDeleted = false;
      errors.push({ provider: 'cloudflare', project: options.cloudflareProject, detail: result.stderr || result.stdout || 'Unknown error' });
    }
  }

  if (options.vercelProject) {
    const result = await runner('vercel', ['project', 'rm', options.vercelProject, '--yes', '--no-color'], {
      cwd: options.workspacePath,
      timeout: 60_000,
      env: { ...env, CI: 'true' },
    });
    if (!result.success) {
      vercelDeleted = false;
      errors.push({ provider: 'vercel', project: options.vercelProject, detail: result.stderr || result.stdout || 'Unknown error' });
    }
  }

  return { vercel: vercelDeleted, cloudflare: cloudflareDeleted, errors };
}
