import { describe, expect, it } from 'vitest';
import { InfisicalBackend } from '../src/index.js';
import type { CliOptions, CliResult, CommandRunner } from '../src/cli.js';

const ok = (stdout = ''): CliResult => ({ stdout, stderr: '', exitCode: 0, success: true });
const fail = (stderr = 'failed'): CliResult => ({ stdout: '', stderr, exitCode: 1, success: false });

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type FetchCall = { url: string; init: RequestInit };

const stubFetch = (handler: (url: string, init: RequestInit) => Response): { fetchImpl: typeof fetch; calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return handler(url, requestInit);
  }) as typeof fetch;
  return { fetchImpl, calls };
};

type RunnerCall = { command: string; args: string[]; options?: CliOptions };

const recordingRunner = (handler: (call: RunnerCall) => CliResult): { runner: CommandRunner; calls: RunnerCall[] } => {
  const calls: RunnerCall[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    return handler(call);
  };
  return { runner, calls };
};

// API path: both token and projectId must be present. Explicit values keep tests
// independent of any INFISICAL_* variables in the developer's own environment.
const apiConfig = {
  type: 'infisical' as const,
  options: { projectId: 'proj-1', serviceToken: 'svc-token', environment: 'dev', apiUrl: 'https://api.test/' },
};

// CLI path: an explicit empty serviceToken overrides the environment, forcing the CLI path.
const cliConfig = {
  type: 'infisical' as const,
  options: { projectId: 'proj-1', serviceToken: '', environment: 'dev' },
};

const secretsPayload = {
  secrets: [
    { secretKey: 'GITHUB_TOKEN', secretValue: 'ghp_aaa', version: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    { secretKey: 'VERCEL_TOKEN', secretValue: 'vc_bbb' },
  ],
};

describe('InfisicalBackend (API path)', () => {
  it('gets a secret value via GET /api/v4/secrets and keeps the value out of the URL', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, secretsPayload));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.get('GITHUB_TOKEN')).resolves.toBe('ghp_aaa');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('https://api.test/api/v4/secrets?');
    expect(calls[0].url).toContain('projectId=proj-1');
    expect(calls[0].url).toContain('viewSecretValue=true');
    expect(calls[0].url).not.toContain('ghp_aaa');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer svc-token' });
  });

  it('get returns null when the API fails instead of throwing', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(500, { message: 'boom' }));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.get('GITHUB_TOKEN')).resolves.toBeNull();
  });

  it('set updates via PATCH with the value in the JSON body, never in the URL', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { secret: { secretKey: 'GITHUB_TOKEN' } }));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.set('GITHUB_TOKEN', 'ghp_new')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('PATCH');
    expect(calls[0].url).not.toContain('ghp_new');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      projectId: 'proj-1',
      environment: 'dev',
      secretValue: 'ghp_new',
    });
  });

  it('set falls back to POST create when PATCH reports 404', async () => {
    const { fetchImpl, calls } = stubFetch((_url, init) =>
      init.method === 'PATCH'
        ? jsonResponse(404, { message: 'not found' })
        : jsonResponse(200, { secret: { secretKey: 'NEW_KEY' } }),
    );
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.set('NEW_KEY', 'v1')).resolves.toBeUndefined();
    expect(calls.map(call => call.init.method)).toEqual(['PATCH', 'POST']);
    expect(JSON.parse(String(calls[1].init.body)).secretValue).toBe('v1');
  });

  it('set throws when both PATCH and POST fail', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(403, { message: 'forbidden' }));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.set('GITHUB_TOKEN', 'x')).rejects.toThrow(/HTTP 403/);
  });

  it('delete sends projectId/environment in the JSON body and treats 404 as success', async () => {
    const missing = stubFetch(() => jsonResponse(404, { message: 'not found' }));
    const backendMissing = new InfisicalBackend(apiConfig, undefined, missing.fetchImpl);
    await expect(backendMissing.delete('GONE')).resolves.toBeUndefined();
    expect(JSON.parse(String(missing.calls[0].init.body))).toEqual({ projectId: 'proj-1', environment: 'dev' });

    const failed = stubFetch(() => jsonResponse(500, { message: 'db down' }));
    const backendFailed = new InfisicalBackend(apiConfig, undefined, failed.fetchImpl);
    await expect(backendFailed.delete('GITHUB_TOKEN')).rejects.toThrow(/HTTP 500/);
  });

  it('getSecret passes through only the fields the API actually returned', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, secretsPayload));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    const withMeta = await backend.getSecret('GITHUB_TOKEN');
    expect(withMeta).toMatchObject({ key: 'GITHUB_TOKEN', value: 'ghp_aaa', version: 3, status: 'active' });
    expect(withMeta?.metadata).toEqual({ backend: 'infisical', environment: 'dev', projectId: 'proj-1' });

    const bare = await backend.getSecret('VERCEL_TOKEN');
    expect(bare?.value).toBe('vc_bbb');
    expect(bare).not.toHaveProperty('version');
    expect(bare).not.toHaveProperty('createdAt');
    expect(bare).not.toHaveProperty('updatedAt');
  });

  it('listKeys and getAll read the API list; listKeys is sorted', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, secretsPayload));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.listKeys()).resolves.toEqual(['GITHUB_TOKEN', 'VERCEL_TOKEN']);
    await expect(backend.getAll()).resolves.toEqual({ GITHUB_TOKEN: 'ghp_aaa', VERCEL_TOKEN: 'vc_bbb' });
  });

  it('isAvailable probes the API and reports the failure reason when unreachable', async () => {
    const reachable = stubFetch(() => jsonResponse(200, secretsPayload));
    const backendOk = new InfisicalBackend(apiConfig, undefined, reachable.fetchImpl);
    await expect(backendOk.isAvailable()).resolves.toEqual({ available: true });

    const unreachable = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const backendDown = new InfisicalBackend(apiConfig, undefined, unreachable.fetchImpl);
    const status = await backendDown.isAvailable();
    expect(status.available).toBe(false);
    expect(status.reason).toContain('unreachable');
  });

  it('rotate writes the new value and returns the backend-confirmed secret', async () => {
    let stored = 'ghp_old';
    const { fetchImpl } = stubFetch((url, init) => {
      if (init.method === 'PATCH') {
        stored = (JSON.parse(String(init.body)) as { secretValue: string }).secretValue;
        return jsonResponse(200, { secret: {} });
      }
      return jsonResponse(200, { secrets: [{ secretKey: 'GITHUB_TOKEN', secretValue: stored, version: 4 }] });
    });
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    const rotated = await backend.rotate('GITHUB_TOKEN', 'ghp_rotated');
    expect(rotated.value).toBe('ghp_rotated');
    expect(rotated.version).toBe(4);
  });

  it('getHistory returns no fabricated history', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, secretsPayload));
    const backend = new InfisicalBackend(apiConfig, undefined, fetchImpl);
    await expect(backend.getHistory('GITHUB_TOKEN')).resolves.toEqual([]);
  });
});

describe('InfisicalBackend (CLI path)', () => {
  const expectedShell = process.platform === 'win32' ? 'win32' : undefined;

  it('get parses CLI JSON output shapes and falls back to plain stdout', async () => {
    const container = recordingRunner(({ args }) => ok(JSON.stringify({ secrets: [{ secretKey: 'K', secretValue: 'v1' }] })));
    const backendContainer = new InfisicalBackend(cliConfig, container.runner);
    await expect(backendContainer.get('K')).resolves.toBe('v1');

    const plain = recordingRunner(() => ok('raw-value\n'));
    const backendPlain = new InfisicalBackend(cliConfig, plain.runner);
    await expect(backendPlain.get('K')).resolves.toBe('raw-value');

    const broken = recordingRunner(() => fail('command not found'));
    const backendBroken = new InfisicalBackend(cliConfig, broken.runner);
    await expect(backendBroken.get('K')).resolves.toBeNull();
  });

  it('get passes the key and format flag (not the value) and projectId to the CLI', async () => {
    const { runner, calls } = recordingRunner(({ args }) => (args.includes('--format') ? ok('v') : fail()));
    const backend = new InfisicalBackend(cliConfig, runner);
    await backend.get('GITHUB_TOKEN');
    expect(calls[0].command).toBe('infisical');
    expect(calls[0].args).toEqual(['secrets', 'get', 'GITHUB_TOKEN', '--format', 'json', '--projectId', 'proj-1']);
    expect(calls[0].options?.shell).toBe(expectedShell);
  });

  it('set passes KEY=VALUE in argv (declared CLI limitation) and throws on failure', async () => {
    const { runner, calls } = recordingRunner(() => ok(''));
    const backend = new InfisicalBackend(cliConfig, runner);
    await backend.set('GITHUB_TOKEN', 'ghp_x');
    expect(calls[0].args).toContain('GITHUB_TOKEN=ghp_x');
    expect(calls[0].args).toContain('--env');
    expect(calls[0].args).toContain('dev');

    const failing = recordingRunner(() => fail('permission denied'));
    const backendFailing = new InfisicalBackend(cliConfig, failing.runner);
    await expect(backendFailing.set('GITHUB_TOKEN', 'ghp_x')).rejects.toThrow(/failed to set "GITHUB_TOKEN"/);
  });

  it('delete throws on CLI failure; listKeys returns [] when list fails', async () => {
    const failing = recordingRunner(() => fail('permission denied'));
    const backendFailing = new InfisicalBackend(cliConfig, failing.runner);
    await expect(backendFailing.delete('GITHUB_TOKEN')).rejects.toThrow(/failed to delete "GITHUB_TOKEN"/);
    await expect(backendFailing.listKeys()).resolves.toEqual([]);

    const working = recordingRunner(({ args }) => (args.includes('list') ? ok(JSON.stringify({ secrets: [{ secretKey: 'B' }, { secretKey: 'A' }] })) : ok('')));
    const backendWorking = new InfisicalBackend(cliConfig, working.runner);
    await expect(backendWorking.listKeys()).resolves.toEqual(['A', 'B']);
  });

  it('getSecret on the CLI path omits version and timestamps instead of fabricating them', async () => {
    const { runner } = recordingRunner(({ args }) => (args.includes('get') ? ok('v') : fail()));
    const backend = new InfisicalBackend(cliConfig, runner);
    const secret = await backend.getSecret('GITHUB_TOKEN');
    expect(secret).toMatchObject({ key: 'GITHUB_TOKEN', value: 'v', status: 'active' });
    expect(secret).not.toHaveProperty('version');
    expect(secret).not.toHaveProperty('createdAt');
    expect(secret).not.toHaveProperty('updatedAt');
  });

  it('isAvailable distinguishes missing CLI, missing auth, and missing projectId', async () => {
    const notInstalled = recordingRunner(() => fail('not found'));
    const backendNotInstalled = new InfisicalBackend(cliConfig, notInstalled.runner);
    const missing = await backendNotInstalled.isAvailable();
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain('not installed');

    const notAuthenticated = recordingRunner(({ args }) => (args.includes('--version') ? ok('1.0.0') : fail('not logged in')));
    const backendNotAuthenticated = new InfisicalBackend(cliConfig, notAuthenticated.runner);
    const unauthenticated = await backendNotAuthenticated.isAvailable();
    expect(unauthenticated.available).toBe(false);
    expect(unauthenticated.reason).toContain('Not authenticated');

    const noProject = new InfisicalBackend({ type: 'infisical', options: { projectId: '', serviceToken: '' } }, recordingRunner(() => ok('1.0.0')).runner);
    const noProjectStatus = await noProject.isAvailable();
    expect(noProjectStatus.available).toBe(false);
    expect(noProjectStatus.reason).toContain('projectId');

    const ready = recordingRunner(() => ok('1.0.0'));
    const backendReady = new InfisicalBackend(cliConfig, ready.runner);
    await expect(backendReady.isAvailable()).resolves.toEqual({ available: true });
  });

  it('approve and reject throw instead of fabricating approval state', async () => {
    const backend = new InfisicalBackend(cliConfig, recordingRunner(() => ok('')).runner);
    await expect(backend.approve('K', 1, 'tester')).rejects.toThrow(/approval workflows/);
    await expect(backend.reject('K', 1, 'nope')).rejects.toThrow(/rejection/);
  });

  it('rotate on the CLI path sets the provided value and reads it back', async () => {
    const { runner, calls } = recordingRunner(({ args }) => (args.includes('get') ? ok('rotated-value') : ok('')));
    const backend = new InfisicalBackend(cliConfig, runner);
    const rotated = await backend.rotate('GITHUB_TOKEN', 'rotated-value');
    expect(rotated.value).toBe('rotated-value');
    expect(calls.some(call => call.args.includes('GITHUB_TOKEN=rotated-value'))).toBe(true);
  });
});
