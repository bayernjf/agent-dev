/**
 * Local file secret backend.
 *
 * Stores secrets in ~/.agent-dev/credentials.json with file permissions 0600.
 * Supports version history, approval workflow, and rotation.
 *
 * Backward compatible: if the legacy credentials.txt (KEY=VALUE format) exists,
 * it is migrated to the new JSON format on first write.
 */

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { SecretBackend, SecretBackendConfig, Secret, SecretVersion } from './index.js';

type StorageFormat = {
  version: 1;
  secrets: Record<string, Secret>;
};

export class LocalFileBackend implements SecretBackend {
  readonly type = 'local-file' as const;
  private readonly path: string;
  private readonly legacyPath: string;

  constructor(config: SecretBackendConfig) {
    const baseDir = config.options?.path ?? process.env.AGENT_DEV_CREDENTIALS_PATH ?? join(homedir(), '.agent-dev');
    this.path = baseDir.endsWith('.json') ? baseDir : join(baseDir, 'credentials.json');
    this.legacyPath = join(dirname(this.path), 'credentials.txt');
  }

  async get(key: string): Promise<string | null> {
    const secret = await this.getSecret(key);
    return secret?.value ?? null;
  }

  async getSecret(key: string): Promise<Secret | null> {
    const store = await this.readStore();
    return store.secrets[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const store = await this.readStore();
    const now = new Date().toISOString();
    const existing = store.secrets[key];

    if (existing) {
      const newVersion: SecretVersion = {
        version: (existing.version ?? 0) + 1,
        value,
        createdAt: now,
        status: 'active',
      };
      existing.value = value;
      existing.version = newVersion.version;
      existing.updatedAt = now;
      existing.status = 'active';
      existing.history = [newVersion, ...(existing.history ?? [])].slice(0, 50);
    } else {
      const secret: Secret = {
        key,
        value,
        version: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        history: [{ version: 1, value, createdAt: now, status: 'active' }],
      };
      store.secrets[key] = secret;
    }

    await this.writeStore(store);
  }

  async delete(key: string): Promise<void> {
    const store = await this.readStore();
    delete store.secrets[key];
    await this.writeStore(store);
  }

  async listKeys(): Promise<string[]> {
    const store = await this.readStore();
    return Object.keys(store.secrets).sort();
  }

  async getAll(): Promise<Record<string, string>> {
    const store = await this.readStore();
    const result: Record<string, string> = {};
    for (const [key, secret] of Object.entries(store.secrets)) {
      result[key] = secret.value;
    }
    return result;
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { available: true };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async rotate(key: string, newValue?: string): Promise<Secret> {
    const value = newValue ?? this.generateSecret();
    await this.set(key, value);
    const secret = await this.getSecret(key);
    if (!secret) throw new Error(`Secret "${key}" not found after rotation.`);
    return secret;
  }

  async approve(key: string, version: number, approver?: string): Promise<Secret> {
    const store = await this.readStore();
    const secret = store.secrets[key];
    if (!secret) throw new Error(`Secret "${key}" not found.`);

    const versionEntry = secret.history?.find(v => v.version === version);
    if (!versionEntry) throw new Error(`Version ${version} not found for secret "${key}".`);

    versionEntry.status = 'active';
    if (approver) versionEntry.approver = approver;

    // If approving a non-current version, make it active
    if (version !== (secret.version ?? 0)) {
      secret.value = versionEntry.value;
      secret.version = version;
      secret.status = 'active';
      secret.updatedAt = new Date().toISOString();
    }

    await this.writeStore(store);
    return secret;
  }

  async reject(key: string, version: number, reason?: string): Promise<Secret> {
    const store = await this.readStore();
    const secret = store.secrets[key];
    if (!secret) throw new Error(`Secret "${key}" not found.`);

    const versionEntry = secret.history?.find(v => v.version === version);
    if (!versionEntry) throw new Error(`Version ${version} not found for secret "${key}".`);

    versionEntry.status = 'rejected';
    if (reason) versionEntry.reason = reason;

    await this.writeStore(store);
    return secret;
  }

  async getHistory(key: string): Promise<SecretVersion[]> {
    const secret = await this.getSecret(key);
    return secret?.history ?? [];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private generateSecret(): string {
    return randomBytes(24).toString('base64url');
  }

  private async readStore(): Promise<StorageFormat> {
    // Migrate legacy format if needed
    if (!existsSync(this.path) && existsSync(this.legacyPath)) {
      const migrated = this.migrateLegacy();
      await this.writeStore(migrated);
      renameSync(this.legacyPath, `${this.legacyPath}.bak`);
      return migrated;
    }

    if (!existsSync(this.path)) return { version: 1, secrets: {} };

    // Fail closed on a corrupted store (2026-11-02 review P1-2): reading it as
    // an empty database let the next set() overwrite the file and silently
    // destroy every stored credential. A truncated or damaged file must surface
    // as a loud error on both reads and writes, never as an empty store.
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      throw corruptedStoreError(this.path, error);
    }
    if (!isStorageFormat(parsed)) {
      throw corruptedStoreError(this.path, new Error('unexpected shape'));
    }
    return parsed;
  }

  private migrateLegacy(): StorageFormat {
    const result: StorageFormat = { version: 1, secrets: {} };
    if (!existsSync(this.legacyPath)) return result;
    const now = new Date().toISOString();
    for (const line of readFileSync(this.legacyPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(key) && value) {
        result.secrets[key] = {
          key,
          value,
          version: 1,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          history: [{ version: 1, value, createdAt: now, status: 'active' }],
        };
      }
    }
    return result;
  }

  private async writeStore(store: StorageFormat): Promise<void> {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Atomic replace + rolling backup: write to a temp file and rename it over
    // the store, so a crash mid-write can never truncate the live file; keep
    // the previous contents as .bak for manual recovery (P1-2, same fix shape
    // as the legacy migration backup).
    const tmpPath = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    if (existsSync(this.path)) {
      copyFileSync(this.path, `${this.path}.bak`);
    }
    renameSync(tmpPath, this.path);
    chmodSync(this.path, 0o600);
  }
}

function isStorageFormat(value: unknown): value is StorageFormat {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StorageFormat>;
  return candidate.version === 1 && !!candidate.secrets && typeof candidate.secrets === 'object';
}

function corruptedStoreError(path: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Credential store at ${path} is corrupted (${reason}); refusing to read or overwrite it. ` +
      `Restore from ${path}.bak or repair the file manually.`
  );
}
