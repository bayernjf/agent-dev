/**
 * Local file secret backend.
 *
 * Stores secrets in ~/.agent-dev/credentials.json with file permissions 0600.
 * Supports version history, approval workflow, and rotation.
 *
 * Backward compatible: if the legacy credentials.txt (KEY=VALUE format) exists,
 * it is migrated to the new JSON format on first write.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { SecretBackend, SecretBackendConfig, Secret, SecretVersion, SecretStatus } from './index.js';

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
        version: existing.version + 1,
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
    if (version !== secret.version) {
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
    try {
      const content = readFileSync(this.path, 'utf8');
      return JSON.parse(content) as StorageFormat;
    } catch {
      return { version: 1, secrets: {} };
    }
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
    writeFileSync(this.path, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
