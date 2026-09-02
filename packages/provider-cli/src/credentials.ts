import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { defaultRunner } from './cli.js';
import { getActiveBackend } from './secret-backend/registry.js';
import { InfisicalBackend } from './secret-backend/infisical.js';

export type Credentials = Record<string, string>;
export type CredentialMeta = { version: 1; updatedAt: string; keys: string[] };

/**
 * Credential storage backend selector.
 *
 * - `local-file` (default): reads/writes ~/.agent-dev/credentials.txt directly — the
 *   historical behaviour, byte-for-byte unchanged.
 * - `infisical` (AGENT_DEV_SECRET_BACKEND=infisical): delegates to the InfisicalBackend
 *   via the SecretBackend abstraction. Reads come from a process-local snapshot hydrated
 *   by `refreshCredentialCache()` at daemon startup and re-hydrated after every write, so
 *   the synchronous `providerCredentialEnv()` call sites (25+ across the provider adapters
 *   and composers) keep working without each one becoming async. External secret changes
 *   made directly in the Infisical console between refreshes are picked up on the next
 *   refresh, not mid-process. There is no silent fallback to the local file: if the
 *   backend is unavailable, refresh throws and the daemon fails to start with the reason.
 */
export type CredentialBackendType = 'local-file' | 'infisical';

export function credentialBackendType(): CredentialBackendType {
  return process.env.AGENT_DEV_SECRET_BACKEND === 'infisical' ? 'infisical' : 'local-file';
}

let backendCache: { credentials: Credentials; fetchedAt: string } | null = null;

export function credentialsPath() { return process.env.AGENT_DEV_CREDENTIALS_PATH ?? join(homedir(), '.agent-dev', 'credentials.txt'); }
function metaPath() { return `${credentialsPath()}.meta.json`; }

/**
 * Hydrate the credential snapshot from the configured backend. No-op for the default
 * local-file backend. Throws with the backend's reason when Infisical is unreachable or
 * misconfigured — callers (daemon startup) treat that as fatal instead of silently
 * reading an empty credential set.
 */
export async function refreshCredentialCache(): Promise<void> {
  if (credentialBackendType() !== 'infisical') return;
  const backend = getActiveBackend();
  const availability = await backend.isAvailable();
  if (!availability.available) {
    throw new Error(`Secret backend "infisical" is not available: ${availability.reason ?? 'unknown reason'}`);
  }
  backendCache = { credentials: await backend.getAll(), fetchedAt: new Date().toISOString() };
}

export function loadCredentials(): Credentials {
  if (credentialBackendType() === 'infisical') {
    if (!backendCache) {
      throw new Error('Infisical credential backend is configured but not hydrated. Await refreshCredentialCache() before reading credentials.');
    }
    return { ...backendCache.credentials };
  }
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  const result: Credentials = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && value) result[key] = value;
  }
  return result;
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  if (credentialBackendType() === 'infisical') {
    const backend = getActiveBackend();
    const current = backendCache?.credentials ?? {};
    // Diff against the snapshot: upsert changed keys, delete removed ones. Individual
    // backend failures throw; the snapshot is only advanced once every write succeeded,
    // so a mid-way failure leaves the cache reflecting what Infisical actually holds
    // before the failed run — re-saving retries exactly the missing writes.
    const next: Credentials = { ...credentials };
    for (const [key, value] of Object.entries(credentials)) {
      if (current[key] !== value) await backend.set(key, value);
    }
    for (const key of Object.keys(current)) {
      if (!(key in credentials)) await backend.delete(key);
    }
    backendCache = { credentials: next, fetchedAt: new Date().toISOString() };
    return;
  }
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lines = ['# Agent-Dev credentials. Never commit or share this file.', `# Updated: ${new Date().toISOString()}`, ''];
  for (const [key, value] of Object.entries(credentials).sort(([a], [b]) => a.localeCompare(b))) lines.push(`${key}=${value}`);
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  const meta: CredentialMeta = { version: 1, updatedAt: new Date().toISOString(), keys: Object.keys(credentials).sort() };
  writeFileSync(metaPath(), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  chmodSync(metaPath(), 0o600);
}

export function getCredentialMeta(): CredentialMeta {
  if (credentialBackendType() === 'infisical') {
    // Keys only, from the hydrated snapshot; the updatedAt is when the snapshot was taken.
    return { version: 1, updatedAt: backendCache?.fetchedAt ?? '', keys: Object.keys(backendCache?.credentials ?? {}).sort() };
  }
  try { return JSON.parse(readFileSync(metaPath(), 'utf8')) as CredentialMeta; } catch { return { version: 1, updatedAt: '', keys: Object.keys(loadCredentials()).sort() }; }
}

/** Read-only backend status for the daemon's /api/credentials/backend route. No secret material. */
export async function getCredentialBackendInfo(): Promise<{
  type: CredentialBackendType;
  available: boolean;
  reason?: string;
  projectId?: string;
  environment?: string;
}> {
  const type = credentialBackendType();
  if (type === 'local-file') return { type, available: true };
  const backend = getActiveBackend();
  const availability = await backend.isAvailable();
  const infisical = backend instanceof InfisicalBackend ? backend : null;
  return {
    type,
    available: availability.available,
    ...(availability.reason ? { reason: availability.reason } : {}),
    ...(infisical?.projectId ? { projectId: infisical.projectId } : {}),
    ...(infisical ? { environment: infisical.environment } : {}),
  };
}

export function providerCredentialEnv() {
  const credentials = loadCredentials();
  return Object.fromEntries(Object.entries(credentials).filter(([key]) => ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN'].includes(key)));
}

export type CredentialVerifyResult = {
  providerId: string;
  status: 'valid' | 'invalid' | 'not_set';
  detail: string;
};

const PROVIDER_CHECKS: { providerId: string; envKey: string; command: string; args: string[]; successCheck?: (stdout: string, stderr: string) => boolean }[] = [
  { providerId: 'github', envKey: 'GITHUB_TOKEN', command: 'gh', args: ['auth', 'status'] },
  { providerId: 'vercel', envKey: 'VERCEL_TOKEN', command: 'vercel', args: ['whoami'], successCheck: (stdout) => stdout.length > 0 },
  { providerId: 'cloudflare', envKey: 'CLOUDFLARE_API_TOKEN', command: 'npx', args: ['wrangler', 'whoami'], successCheck: (stdout, stderr) => !stdout.includes('not authenticated') && !stderr.includes('not authenticated') },
  { providerId: 'supabase', envKey: 'SUPABASE_ACCESS_TOKEN', command: 'supabase', args: ['projects', 'list'] },
];

export async function verifyCredentials(credentials: Credentials): Promise<CredentialVerifyResult[]> {
  const results: CredentialVerifyResult[] = [];
  for (const check of PROVIDER_CHECKS) {
    const token = credentials[check.envKey];
    if (!token) {
      results.push({ providerId: check.providerId, status: 'not_set', detail: `${check.envKey} is not configured.` });
      continue;
    }
    try {
      const result = await defaultRunner(check.command, check.args, {
        timeout: 15_000,
        env: { ...process.env, [check.envKey]: token } as Record<string, string>,
      });
      const success = result.success && (check.successCheck ? check.successCheck(result.stdout, result.stderr) : true);
      results.push({
        providerId: check.providerId,
        status: success ? 'valid' : 'invalid',
        detail: success
          ? `Token is valid. Identity: ${(result.stdout || result.stderr).split('\n')[0] ?? 'confirmed'}`
          : `Token validation failed: ${(result.stderr || result.stdout).split('\n')[0] ?? 'unknown error'}`,
      });
    } catch {
      results.push({ providerId: check.providerId, status: 'invalid', detail: `${check.command} is not installed or not accessible.` });
    }
  }
  return results;
}
