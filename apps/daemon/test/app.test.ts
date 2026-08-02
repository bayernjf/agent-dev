import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from '../src/app.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('daemon API', () => {
  it('creates and lists persisted projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-daemon-'));
    directories.push(directory);
    const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
    const { app } = createDaemonApp(store);

    const created = await app.request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Receipt Desk' }),
    });
    expect(created.status).toBe(201);

    const listed = await app.request('http://localhost/api/projects');
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      projects: [{ name: 'Receipt Desk', state: 'NEEDS_INPUT' }],
    });
    await store.close();
  });
});
