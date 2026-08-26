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

export type SecretStatus = 'active' | 'pending' | 'rejected';

export type SecretVersion = {
  version: number;
  value: string;
  createdAt: string;
  status: SecretStatus;
  /** Who approved/rejected this version (optional). */
  approver?: string;
  /** Reason for rejection (optional). */
  reason?: string;
};

export type Secret = {
  key: string;
  value: string;
  /** Current version number. */
  version: number;
  /** Current status. */
  status: SecretStatus;
  createdAt: string;
  updatedAt: string;
  /** Full version history (newest first). */
  history?: SecretVersion[];
  /** Optional metadata: environment, project, etc. */
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

  /** Get full secret with metadata and version history. */
  getSecret(key: string): Promise<Secret | null>;

  /** Set a secret value. Creates a new version. */
  set(key: string, value: string): Promise<void>;

  /** Delete a secret and all its versions. */
  delete(key: string): Promise<void>;

  /** List all secret keys (not values). */
  listKeys(): Promise<string[]>;

  /** Get all secrets (key-value pairs). Use sparingly — prefer get(). */
  getAll(): Promise<Record<string, string>>;

  /** Check if the backend is available and properly configured. */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;

  /**
   * Rotate a secret: create a new version with a new value.
   * If newValue is not provided, generates a random 32-char secret.
   * Returns the new secret.
   */
  rotate(key: string, newValue?: string): Promise<Secret>;

  /**
   * Approve a pending version. Makes it the active version.
   */
  approve(key: string, version: number, approver?: string): Promise<Secret>;

  /**
   * Reject a pending version.
   */
  reject(key: string, version: number, reason?: string): Promise<Secret>;

  /**
   * Get version history for a secret (newest first).
   */
  getHistory(key: string): Promise<SecretVersion[]>;
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
