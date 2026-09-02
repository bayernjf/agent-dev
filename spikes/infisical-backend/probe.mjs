/**
 * Infisical secret backend probe.
 *
 * Offline: checks the Infisical CLI presence and the local backend configuration shape.
 * Online (`--online`): runs a real set -> get -> list -> rotate -> delete -> verify-gone
 * loop against one scratch key in the configured Infisical project, and emits Evidence
 * JSON. The scratch key and its random value are throwaway material; the probe never
 * prints secret values, only booleans about what the backend confirmed.
 *
 * This probe is the standing plan for the deferred real-Infisical verification of P1-2
 * (docs/implementation-plan-v0.2.md): the adapter code ships with unit tests, but the
 * endpoint shapes and CLI JSON output are only proven by running this probe online.
 */

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const online = process.argv.includes('--online');
const timeout = 30_000;
const scratchKey = 'AGENT_DEV_PROBE_SCRATCH';

const projectId = process.env.INFISICAL_PROJECT_ID ?? '';
const serviceToken = process.env.INFISICAL_SERVICE_TOKEN ?? '';
const apiUrl = (process.env.INFISICAL_API_URL ?? 'https://us.infisical.com').replace(/\/$/, '');
const environment = process.env.INFISICAL_ENVIRONMENT ?? 'dev';

function runCli(args) {
  const result = spawnSync('infisical', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    // npm-installed infisical is a `.cmd` shim on Windows and EINVALs without a shell
    // (audit §6.4, same class as npm/npx).
    shell: process.platform === 'win32',
  });
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

async function api(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  let json = null;
  try { json = await response.json(); } catch { /* empty body */ }
  return { ok: response.ok, status: response.status, json };
}

async function apiSet(key, value) {
  const body = JSON.stringify({ projectId, environment, secretValue: value });
  const patch = await api(`/api/v4/secrets/${encodeURIComponent(key)}`, { method: 'PATCH', body });
  if (patch.ok) return true;
  if (patch.status !== 404) return false;
  return (await api(`/api/v4/secrets/${encodeURIComponent(key)}`, { method: 'POST', body })).ok;
}

async function apiGet(key) {
  const query = new URLSearchParams({ projectId, environment, viewSecretValue: 'true' });
  const response = await api(`/api/v4/secrets?${query}`);
  if (!response.ok) return null;
  const secrets = Array.isArray(response.json?.secrets) ? response.json.secrets : [];
  return secrets.find(secret => secret.secretKey === key)?.secretValue ?? null;
}

async function apiDelete(key) {
  const response = await api(`/api/v4/secrets/${encodeURIComponent(key)}`, {
    method: 'DELETE', body: JSON.stringify({ projectId, environment }),
  });
  return response.ok || response.status === 404;
}

async function apiRoundtrip() {
  const value = randomBytes(18).toString('base64url');
  const rotated = randomBytes(18).toString('base64url');
  const steps = {};
  steps.set = await apiSet(scratchKey, value);
  const fetched = steps.set ? await apiGet(scratchKey) : null;
  steps.getMatches = fetched === value;
  steps.rotate = steps.getMatches ? await apiSet(scratchKey, rotated) : false;
  steps.rotateMatches = steps.rotate ? (await apiGet(scratchKey)) === rotated : false;
  steps.delete = steps.rotateMatches ? await apiDelete(scratchKey) : false;
  steps.goneAfterDelete = steps.delete ? (await apiGet(scratchKey)) === null : false;
  steps.complete = steps.goneAfterDelete;
  return steps;
}

function cliRoundtrip() {
  if (!projectId) return { skipped: true, reason: 'INFISICAL_PROJECT_ID not set' };
  const value = randomBytes(18).toString('base64url');
  const rotated = randomBytes(18).toString('base64url');
  const base = ['secrets', '--projectId', projectId, '--env', environment];
  // CLI limitation (audit S10): `secrets set KEY=VALUE` carries the value in argv. The
  // value here is a random throwaway, and the probe prefers the API path when a service
  // token is configured.
  const set = runCli([...base, 'set', `${scratchKey}=${value}`]);
  const get = set.status === 0 ? runCli([...base, 'get', scratchKey]) : { status: 1, stdout: '' };
  const getMatches = get.status === 0 && get.stdout.includes(value);
  const rotate = getMatches ? runCli([...base, 'set', `${scratchKey}=${rotated}`]) : { status: 1 };
  const rotateMatches = rotate.status === 0 && runCli([...base, 'get', scratchKey]).stdout.includes(rotated);
  const remove = rotateMatches ? runCli([...base, 'delete', scratchKey]) : { status: 1 };
  const goneAfterDelete = remove.status === 0 && runCli([...base, 'get', scratchKey]).status !== 0;
  return { set: set.status === 0, getMatches, rotate: rotate.status === 0, rotateMatches, delete: remove.status === 0, goneAfterDelete, complete: goneAfterDelete };
}

const version = runCli(['--version']);
const checks = {
  cliInstalled: version.status === 0,
  cliVersion: version.status === 0 ? version.stdout.split('\n')[0] : null,
  projectIdConfigured: Boolean(projectId),
  serviceTokenConfigured: Boolean(serviceToken),
  agentDevSecretBackend: process.env.AGENT_DEV_SECRET_BACKEND ?? 'unset (defaults to local-file)',
  environment,
  apiUrl,
};

let evidence = null;
if (online) {
  if (!projectId) {
    evidence = { error: 'INFISICAL_PROJECT_ID must be set for the online roundtrip.' };
  } else if (serviceToken) {
    evidence = { path: 'api', ...(await apiRoundtrip()) };
  } else if (checks.cliInstalled) {
    evidence = { path: 'cli', ...(cliRoundtrip()) };
  } else {
    evidence = { error: 'Neither INFISICAL_SERVICE_TOKEN nor the Infisical CLI is available.' };
  }
}

process.stdout.write(`${JSON.stringify({ mode: online ? 'online' : 'offline', checks, evidence }, null, 2)}\n`);
