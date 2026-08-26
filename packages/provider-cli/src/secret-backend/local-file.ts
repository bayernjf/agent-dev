/**
 * Local file secret backend.
 *
 * Stores secrets in ~/.agent-dev/credentials.txt with file permissions 0600.
 * This is the default backend for local development.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { SecretBackend, SecretBackendConfig } from './index.js';

export class LocalFileBackend implements SecretBackend {
  readonly type = 'local-file' as const;
  private readonly path: string;

  constructor(config: SecretBackendConfig) {
    this.path = config.options?.path ?? process.env.AGENT_DEV_CREDENTIALS_PATH ?? join(homedir(), '.agent-dev', 'credentials.txt');
  }

  async get(key: string): Promise<string | null> {
    const all = await this.getAll();
    return all[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const all = await this.getAll();
    all[key] = value;
    await this.writeAll(all);
  }

  async delete(key: string): Promise<void> {
    const all = await this.getAll();
    delete all[key];
    await this.writeAll(all);
  }

  async listKeys(): Promise<string[]> {
    const all = await this.getAll();
    return Object.keys(all).sort();
  }

  async getAll(): Promise<Record<string, string>> {
    if (!existsSync(this.path)) return {};
    const result: Record<string, string> = {};
    for (const line of readFileSync(this.path, 'utf8').split(/\r?\n/)) {
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

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { available: true };
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async writeAll(credentials: Record<string, string>): Promise<void> {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lines = [
      '# Agent-Dev credentials. Never commit or share this file.',
      `# Updated: ${new Date().toISOString()}`,
      '',
    ];
    for (const [key, value] of Object.entries(credentials).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${key}=${value}`);
    }
    writeFileSync(this.path, `${lines.join('\n')}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
