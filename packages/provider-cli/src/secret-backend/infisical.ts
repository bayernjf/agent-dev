/**
 * Infisical secret backend.
 *
 * Two authentication paths, mirroring the Vercel composer's
 * `disableVercelDeploymentProtection` pattern:
 *
 * - **API path** (`INFISICAL_SERVICE_TOKEN` set): REST API `/api/v4/secrets` over `fetch`.
 *   Secret values travel in JSON bodies, never in argv (fixes audit S10). Endpoints are
 *   implemented from the published OpenAPI reference
 *   (https://infisical.com/docs/api-reference/endpoints/secrets/…, confirmed 2026-09-01:
 *   GET /api/v4/secrets, POST/PATCH/DELETE /api/v4/secrets/{secretName}, Bearer auth,
 *   JSON request bodies). The shapes are NOT yet verified against a live project — real
 *   Infisical verification is deferred (docs/credential-management.md, P1-2 status).
 * - **CLI path** (no token): `infisical secrets get/set/delete/list` via the injected
 *   runner. NOTE: `secrets set KEY=VALUE` puts the value into argv, which is visible in
 *   the local process list (audit S10). That is a CLI limitation, declared here rather
 *   than disguised — prefer the API path for writes.
 *
 * Honesty rules (docs/credential-management.md 4.2): this adapter only reports fields the
 * backend actually confirmed. The Infisical CLI exposes no version data, so CLI-path
 * Secrets omit version/timestamps and `getHistory()` returns []. Approval workflows are
 * native to the Infisical dashboard; `approve()`/`reject()` throw instead of fabricating
 * approval state.
 */

import { randomBytes } from 'node:crypto';
import { defaultRunner, type CliOptions, type CommandRunner } from '../cli.js';
import type { SecretBackend, SecretBackendConfig, Secret, SecretVersion } from './index.js';

/** Default REST API origin per the Infisical OpenAPI servers list (US region). */
const DEFAULT_API_URL = 'https://us.infisical.com';

type ApiSecret = {
  secretKey?: string;
  secretValue?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ApiResponse = {
  ok: boolean;
  status: number;
  message: string;
  json: { secret?: ApiSecret; secrets?: ApiSecret[]; message?: string } | null;
};

export class InfisicalBackend implements SecretBackend {
  readonly type = 'infisical' as const;
  /** Exposed read-only for status endpoints; contains no secret material. */
  readonly projectId: string | undefined;
  readonly environment: string;
  private readonly workspace?: string;
  private readonly apiUrl: string;
  private readonly serviceToken?: string;
  private readonly runner: CommandRunner;
  private readonly fetchImpl: typeof fetch;
  private readonly cliOptions: CliOptions;

  constructor(config: SecretBackendConfig, runner: CommandRunner = defaultRunner, fetchImpl: typeof fetch = fetch) {
    this.projectId = config.options?.projectId ?? process.env.INFISICAL_PROJECT_ID;
    this.environment = config.options?.environment ?? process.env.INFISICAL_ENVIRONMENT ?? 'dev';
    this.workspace = config.options?.workspace ?? process.env.INFISICAL_WORKSPACE;
    this.apiUrl = (config.options?.apiUrl ?? process.env.INFISICAL_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.serviceToken = config.options?.serviceToken ?? process.env.INFISICAL_SERVICE_TOKEN;
    this.runner = runner;
    this.fetchImpl = fetchImpl;
    // npm-installed infisical resolves to a `.cmd` shim on Windows and EINVALs without a shell
    // (audit §6.4, npm/npx same class of problem).
    this.cliOptions = { timeout: 15_000, shell: process.platform === 'win32' ? 'win32' : undefined };
  }

  async get(key: string): Promise<string | null> {
    if (this.hasApiAuth()) {
      try {
        return (await this.apiFind(key, true))?.secretValue ?? null;
      } catch {
        return null;
      }
    }
    try {
      const result = await this.runner('infisical', this.buildArgs(['secrets', 'get', key, '--format', 'json']), this.cliOptions);
      if (!result.success) return null;
      return parseCliSecretValue(result.stdout);
    } catch {
      return null;
    }
  }

  async getSecret(key: string): Promise<Secret | null> {
    const metadata = { backend: 'infisical', environment: this.environment, ...(this.projectId ? { projectId: this.projectId } : {}) };
    if (this.hasApiAuth()) {
      const apiSecret = await this.apiFind(key, true);
      if (!apiSecret?.secretValue) return null;
      return {
        key,
        value: apiSecret.secretValue,
        // Only the fields the API actually returned; no fabricated versions or timestamps.
        ...(apiSecret.version !== undefined ? { version: apiSecret.version } : {}),
        ...(apiSecret.createdAt ? { createdAt: apiSecret.createdAt } : {}),
        ...(apiSecret.updatedAt ? { updatedAt: apiSecret.updatedAt } : {}),
        status: 'active',
        metadata,
      };
    }
    const value = await this.get(key);
    if (!value) return null;
    return { key, value, status: 'active', metadata };
  }

  async set(key: string, value: string): Promise<void> {
    if (this.hasApiAuth()) {
      await this.apiUpsert(key, value);
      return;
    }
    // CLI limitation: the value is part of argv and visible in the local process list (S10).
    const result = await this.runner('infisical', this.buildArgs(['secrets', 'set', `${key}=${value}`, '--env', this.environment]), this.cliOptions);
    if (!result.success) throw new Error(`Infisical CLI failed to set "${key}": ${result.stderr || result.stdout || 'unknown error'}`);
  }

  async delete(key: string): Promise<void> {
    if (this.hasApiAuth()) {
      const response = await this.apiRequest(`/api/v4/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        body: { projectId: this.projectId, environment: this.environment },
      });
      // Deleting an already-absent secret is a no-op, not a failure.
      if (response.ok || response.status === 404) return;
      throw new Error(`Infisical API failed to delete "${key}" (HTTP ${response.status}): ${response.message}`);
    }
    const result = await this.runner('infisical', this.buildArgs(['secrets', 'delete', key, '--env', this.environment]), this.cliOptions);
    if (!result.success) throw new Error(`Infisical CLI failed to delete "${key}": ${result.stderr || result.stdout || 'unknown error'}`);
  }

  async listKeys(): Promise<string[]> {
    return (await this.listApiOrCli(false)).map(secret => secret.secretKey).filter((key): key is string => Boolean(key)).sort();
  }

  async getAll(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const secret of await this.listApiOrCli(true)) {
      if (secret.secretKey && secret.secretValue) result[secret.secretKey] = secret.secretValue;
    }
    return result;
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    if (this.hasApiAuth()) {
      try {
        await this.apiList(false);
        return { available: true };
      } catch (error) {
        return { available: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    const version = await this.runner('infisical', ['--version'], { timeout: 5_000, shell: this.cliOptions.shell });
    if (!version.success) {
      return { available: false, reason: 'Infisical CLI is not installed. Run: npm install -g infisical' };
    }
    // NOTE: `infisical whoami` and the CLI JSON output shapes below are per the same
    // unverified CLI surface as before; they still need a live Infisical run to confirm.
    const whoami = await this.runner('infisical', ['whoami'], { timeout: 5_000, shell: this.cliOptions.shell });
    if (!whoami.success) {
      return { available: false, reason: 'Not authenticated with Infisical. Run: infisical login' };
    }
    if (!this.projectId) {
      return { available: false, reason: 'Infisical projectId not configured. Set INFISICAL_PROJECT_ID or pass in backend config.' };
    }
    return { available: true };
  }

  async rotate(key: string, newValue?: string): Promise<Secret> {
    const value = newValue ?? randomBytes(24).toString('base64url');
    await this.set(key, value);
    const secret = await this.getSecret(key);
    if (!secret) throw new Error(`Secret "${key}" not found after rotation.`);
    return secret;
  }

  async approve(_key: string, _version: number, _approver?: string): Promise<Secret> {
    throw new Error('Infisical approval workflows run in the Infisical dashboard. The adapter does not fabricate approval state.');
  }

  async reject(_key: string, _version: number, _reason?: string): Promise<Secret> {
    throw new Error('Infisical approval workflows run in the Infisical dashboard. The adapter does not fabricate rejection state.');
  }

  /**
   * The adapter does not expose version history: the confirmed v4 endpoints do not include
   * a versions read, and the CLI exposes none. Returns [] rather than inventing history.
   */
  async getHistory(_key: string): Promise<SecretVersion[]> {
    return [];
  }

  // ---------------------------------------------------------------------------
  // API path
  // ---------------------------------------------------------------------------

  private hasApiAuth(): boolean {
    return Boolean(this.serviceToken && this.projectId);
  }

  private async apiRequest(
    path: string,
    init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
  ): Promise<ApiResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (error) {
      throw new Error(`Infisical API unreachable at ${this.apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let json: ApiResponse['json'] = null;
    try {
      json = (await response.json()) as ApiResponse['json'];
    } catch {
      // Empty or non-JSON body; status carries the outcome.
    }
    const message = (json?.message as string | undefined) ?? (response.statusText || 'unknown error');
    return { ok: response.ok, status: response.status, message, json };
  }

  private async apiList(viewSecretValue: boolean): Promise<ApiSecret[]> {
    const query = new URLSearchParams({
      projectId: this.projectId ?? '',
      environment: this.environment,
      viewSecretValue: String(viewSecretValue),
    });
    const response = await this.apiRequest(`/api/v4/secrets?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Infisical API list failed (HTTP ${response.status}): ${response.message}`);
    }
    return Array.isArray(response.json?.secrets) ? response.json.secrets : [];
  }

  private async apiFind(key: string, viewSecretValue: boolean): Promise<ApiSecret | null> {
    const secrets = await this.apiList(viewSecretValue);
    return secrets.find(secret => secret.secretKey === key) ?? null;
  }

  /** Update the secret; create it when Infisical reports it does not exist (HTTP 404). */
  private async apiUpsert(key: string, value: string): Promise<void> {
    const update = await this.apiRequest(`/api/v4/secrets/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: { projectId: this.projectId, environment: this.environment, secretValue: value },
    });
    if (update.ok) return;
    if (update.status !== 404) {
      throw new Error(`Infisical API failed to set "${key}" (HTTP ${update.status}): ${update.message}`);
    }
    const create = await this.apiRequest(`/api/v4/secrets/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: { projectId: this.projectId, environment: this.environment, secretValue: value },
    });
    if (!create.ok) {
      throw new Error(`Infisical API failed to create "${key}" (HTTP ${create.status}): ${create.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CLI path
  // ---------------------------------------------------------------------------

  private async listApiOrCli(viewSecretValue: boolean): Promise<ApiSecret[]> {
    if (this.hasApiAuth()) {
      try {
        return await this.apiList(viewSecretValue);
      } catch {
        return [];
      }
    }
    try {
      const result = await this.runner('infisical', this.buildArgs(['secrets', 'list', '--format', 'json']), this.cliOptions);
      if (!result.success) return [];
      return parseCliSecretList(result.stdout);
    } catch {
      return [];
    }
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

/**
 * Parse `infisical secrets get KEY --format json` output. The exact CLI JSON shape is not
 * yet verified against a live CLI, so accept the plausible containers and fall back to the
 * raw stdout as a plain value.
 */
function parseCliSecretValue(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed || null;
    if (Array.isArray(parsed)) {
      const first = parsed[0] as { value?: string; secretValue?: string } | undefined;
      return first?.value ?? first?.secretValue ?? null;
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.secrets)) return parseCliSecretValue(JSON.stringify(record.secrets[0] ?? ''));
      if (record.secret && typeof record.secret === 'object') {
        const secret = record.secret as { value?: string; secretValue?: string };
        return secret.value ?? secret.secretValue ?? null;
      }
      if (typeof record.value === 'string') return record.value;
      if (typeof record.secretValue === 'string') return record.secretValue;
    }
  } catch {
    // Not JSON: the CLI printed the plain value.
  }
  return trimmed;
}

/** Parse `infisical secrets list --format json` output with the same defensive posture. */
function parseCliSecretList(stdout: string): ApiSecret[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed as ApiSecret[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { secrets?: unknown }).secrets)) {
      return (parsed as { secrets: ApiSecret[] }).secrets;
    }
    return [];
  } catch {
    return [];
  }
}
