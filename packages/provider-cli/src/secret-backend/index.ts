/**
 * Secret Backend abstraction for Agent-Dev.
 *
 * Agent-Dev never stores plaintext secrets in its own database. It holds
 * only references (keys) and delegates storage to a SecretBackend.
 *
 * Supported backends:
 * - local-file: ~/.agent-dev/credentials.txt (default, file perms 0600)
 * - infisical: Infisical secret management (via CLI or API)
 * - keychain: macOS Keychain (future)
 * - doppler: Doppler secret management (future)
 */

export type SecretBackendType = 'local-file' | 'infisical' | 'keychain' | 'doppler';

export type Secret = {
  key: string;
  value: string;
  /** Optional metadata: environment, project, last updated, etc. */
  metadata?: Record<string, string>;
};

export type SecretBackendConfig = {
  type: SecretBackendType;
  /** Backend-specific configuration (e.g. Infisical project ID, environment). */
  options?: Record<string, string>;
};

export interface SecretBackend {
  readonly type: SecretBackendType;

  /** Get a secret by key. Returns null if not found. */
  get(key: string): Promise<string | null>;

  /** Set a secret value. Creates or updates. */
  set(key: string, value: string): Promise<void>;

  /** Delete a secret. */
  delete(key: string): Promise<void>;

  /** List all secret keys (not values). */
  listKeys(): Promise<string[]>;

  /** Get all secrets (key-value pairs). Use sparingly — prefer get(). */
  getAll(): Promise<Record<string, string>>;

  /** Check if the backend is available and properly configured. */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
}

// ---------------------------------------------------------------------------
// Backend registry
// ---------------------------------------------------------------------------

const registry = new Map<SecretBackendType, (config: SecretBackendConfig) => SecretBackend>();

export function registerBackend(type: SecretBackendType, factory: (config: SecretBackendConfig) => SecretBackend) {
  registry.set(type, factory);
}

export function createBackend(config: SecretBackendConfig): SecretBackend {
  const factory = registry.get(config.type);
  if (!factory) throw new Error(`Secret backend type "${config.type}" is not registered.`);
  return factory(config);
}

/**
 * Get the default backend configuration.
 * Reads from AGENT_DEV_SECRET_BACKEND env var, falls back to local-file.
 */
export function getDefaultBackendConfig(): SecretBackendConfig {
  const type = (process.env.AGENT_DEV_SECRET_BACKEND as SecretBackendType) ?? 'local-file';
  return { type };
}
