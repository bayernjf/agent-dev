/**
 * Secret backend registry.
 * Registers all built-in secret backends and provides a factory function.
 */

import { registerBackend, createBackend, getDefaultBackendConfig, type SecretBackend, type SecretBackendConfig, type SecretBackendType } from './index.js';
import { LocalFileBackend } from './local-file.js';
import { InfisicalBackend } from './infisical.js';

// Register built-in backends.
registerBackend('local-file', (config) => new LocalFileBackend(config));
registerBackend('infisical', (config) => new InfisicalBackend(config));

export {
  createBackend,
  getDefaultBackendConfig,
  type SecretBackend,
  type SecretBackendConfig,
  type SecretBackendType,
  LocalFileBackend,
  InfisicalBackend,
};

/**
 * Get the active secret backend based on environment configuration.
 * Defaults to local-file if no backend is specified.
 */
export function getActiveBackend(): SecretBackend {
  const config = getDefaultBackendConfig();
  return createBackend(config);
}
