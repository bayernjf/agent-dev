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
      body: JSON.stringify({
        name: 'Receipt Desk',
        answers: { mode: 'professional', analyticsProviders: ['ga4'] },
      }),
    });
    expect(created.status).toBe(201);

    const createdPayload = await created.json() as { project: { id: string; blueprint: { metadata: { revision: number } } } };
    expect(createdPayload.project.blueprint.metadata.revision).toBe(1);

    const revised = await app.request(`http://localhost/api/projects/${createdPayload.project.id}/blueprint`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { mode: 'beginner', analyticsProviders: ['clarity'] } }),
    });
    expect(revised.status).toBe(200);
    await expect(revised.json()).resolves.toMatchObject({
      project: { blueprint: { metadata: { revision: 2 }, spec: { analytics: { providers: ['clarity'] } } } },
    });

    const listed = await app.request('http://localhost/api/projects');
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      projects: [{ name: 'Receipt Desk', state: 'NEEDS_INPUT' }],
    });
    await store.close();
  });
});
