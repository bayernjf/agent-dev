import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type Credentials = Record<string, string>;
export type CredentialMeta = { version: 1; updatedAt: string; keys: string[] };

export function credentialsPath() { return process.env.AGENT_DEV_CREDENTIALS_PATH ?? join(homedir(), '.agent-dev', 'credentials.txt'); }
function metaPath() { return `${credentialsPath()}.meta.json`; }

export function loadCredentials(): Credentials {
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

export function saveCredentials(credentials: Credentials) {
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
  try { return JSON.parse(readFileSync(metaPath(), 'utf8')) as CredentialMeta; } catch { return { version: 1, updatedAt: '', keys: Object.keys(loadCredentials()).sort() }; }
}

export function providerCredentialEnv() {
  const credentials = loadCredentials();
  return Object.fromEntries(Object.entries(credentials).filter(([key]) => ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_ACCESS_TOKEN'].includes(key)));
}
