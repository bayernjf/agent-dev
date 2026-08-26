/**
 * Infisical secret backend.
 *
 * Uses the Infisical CLI to manage secrets. Requires:
 * - Infisical CLI installed (`npm install -g infisical`)
 * - User authenticated (`infisical login`)
 * - Project configured (projectId + environment in config options)
 *
 * Agent-Dev only holds references (keys) and delegates storage to Infisical.
 * Never stores plaintext secrets in Agent-Dev's own database.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecretBackend, SecretBackendConfig } from './index.js';

const execFileAsync = promisify(execFile);

export class InfisicalBackend implements SecretBackend {
  readonly type = 'infisical' as const;
  private readonly projectId?: string;
  private readonly environment: string;
  private readonly workspace?: string;

  constructor(config: SecretBackendConfig) {
    this.projectId = config.options?.projectId ?? process.env.INFISICAL_PROJECT_ID;
    this.environment = config.options?.environment ?? process.env.INFISICAL_ENVIRONMENT ?? 'dev';
    this.workspace = config.options?.workspace ?? process.env.INFISICAL_WORKSPACE;
  }

  async get(key: string): Promise<string | null> {
    try {
      const args = this.buildArgs(['secrets', 'get', key, '--format', 'json']);
      const { stdout } = await execFileAsync('infisical', args, { timeout: 15_000 });
      const parsed = JSON.parse(stdout);
      // Infisical CLI returns { secrets: [{ key, value, ... }] } or similar.
      const secret = Array.isArray(parsed.secrets)
        ? parsed.secrets.find((s: { key: string }) => s.key === key)
        : parsed;
      return secret?.value ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const args = this.buildArgs(['secrets', 'set', `${key}=${value}`, '--env', this.environment]);
    await execFileAsync('infisical', args, { timeout: 15_000 });
  }

  async delete(key: string): Promise<void> {
    const args = this.buildArgs(['secrets', 'delete', key, '--env', this.environment]);
    await execFileAsync('infisical', args, { timeout: 15_000 });
  }

  async listKeys(): Promise<string[]> {
    try {
      const args = this.buildArgs(['secrets', 'list', '--format', 'json']);
      const { stdout } = await execFileAsync('infisical', args, { timeout: 15_000 });
      const parsed = JSON.parse(stdout);
      const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : [];
      return secrets.map((s: { key: string }) => s.key).sort();
    } catch {
      return [];
    }
  }

  async getAll(): Promise<Record<string, string>> {
    try {
      const args = this.buildArgs(['secrets', 'list', '--format', 'json']);
      const { stdout } = await execFileAsync('infisical', args, { timeout: 15_000 });
      const parsed = JSON.parse(stdout);
      const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : [];
      const result: Record<string, string> = {};
      for (const s of secrets) {
        if (s.key && s.value) result[s.key] = s.value;
      }
      return result;
    } catch {
      return {};
    }
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    // Check if Infisical CLI is installed.
    try {
      await execFileAsync('infisical', ['--version'], { timeout: 5_000 });
    } catch {
      return { available: false, reason: 'Infisical CLI is not installed. Run: npm install -g infisical' };
    }

    // Check if authenticated.
    try {
      await execFileAsync('infisical', ['whoami'], { timeout: 5_000 });
    } catch {
      return { available: false, reason: 'Not authenticated with Infisical. Run: infisical login' };
    }

    // Check if project is configured.
    if (!this.projectId) {
      return { available: false, reason: 'Infisical projectId not configured. Set INFISICAL_PROJECT_ID or pass in backend config.' };
    }

    return { available: true };
  }

  private buildArgs(baseArgs: string[]): string[] {
    const args = [...baseArgs];
    if (this.projectId) {
      args.push('--projectId', this.projectId);
    }
    if (this.workspace) {
      args.push('--workspace', this.workspace);
    }
    return args;
  }
}
