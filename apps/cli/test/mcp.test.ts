import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from '@agent-dev/daemon';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentDevMcpServer } from '../src/mcp.js';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

const textOf = (result: ToolCallResult): string => {
  const content = result.content as { type: string; text?: string }[] | undefined;
  const first = content?.[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
};

// The bridge is tested against a real HTTP listener over the real daemon app, so a green test
// proves the whole path: MCP client -> bridge -> daemon route -> store.
async function startBridge(): Promise<Client> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-dev-mcp-'));
  const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
  const { app } = createDaemonApp(store);
  const httpServer = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>(resolve => httpServer.once('listening', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('The test daemon did not bind a port.');
  const mcpServer = createAgentDevMcpServer({ daemonBaseUrl: `http://127.0.0.1:${address.port}` });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '0.0.0' });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await mcpServer.close();
    await new Promise<void>((resolve, reject) => httpServer.close(error => (error ? reject(error) : resolve())));
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return client;
}

describe('agent-dev MCP bridge', () => {
  it('exposes read and progress tools only, never the human gates', async () => {
    const client = await startBridge();
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'agent_dev_create_project',
      'agent_dev_doctor',
      'agent_dev_dry_run',
      'agent_dev_get_feature_task',
      'agent_dev_get_project',
      'agent_dev_get_release',
      'agent_dev_list_projects',
      'agent_dev_request_release',
      'agent_dev_revise_blueprint',
    ]);
    expect(names.some(name => name.includes('approve') || name.includes('accept'))).toBe(false);
  });

  it('creates and reads a project through the daemon', async () => {
    const client = await startBridge();

    const created = await client.callTool({ name: 'agent_dev_create_project', arguments: { name: 'MCP Probe', answers: { mode: 'beginner' } } });
    expect(created.isError).toBeFalsy();
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; state: string } };
    expect(project.state).toBe('NEEDS_INPUT');

    const listed = await client.callTool({ name: 'agent_dev_list_projects', arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(textOf(listed)).toContain(project.id);

    const single = await client.callTool({ name: 'agent_dev_get_project', arguments: { projectId: project.id } });
    expect(single.isError).toBeFalsy();
    expect(JSON.parse(textOf(single))).toMatchObject({ project: { name: 'MCP Probe' } });

    const dryRun = await client.callTool({ name: 'agent_dev_dry_run', arguments: { projectId: project.id } });
    expect(dryRun.isError).toBeFalsy();
    expect(JSON.parse(textOf(dryRun))).toMatchObject({ plan: { noExternalChanges: true } });

    const featureTask = await client.callTool({ name: 'agent_dev_get_feature_task', arguments: { projectId: project.id } });
    expect(featureTask.isError).toBeFalsy();
    expect(JSON.parse(textOf(featureTask))).toMatchObject({ task: null });

    const unknown = await client.callTool({ name: 'agent_dev_get_project', arguments: { projectId: 'missing' } });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('HTTP 404');
  });

  it('surfaces release gates as errors that point to Studio instead of approving anything', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_dev_create_project', arguments: { name: 'Gate Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string } };

    // A fresh project has no completed Apply, so the request is refused at the first gate. The
    // bridge must report the daemon's refusal and where a human continues, never pretend success.
    const blocked = await client.callTool({ name: 'agent_dev_request_release', arguments: { projectId: project.id } });
    expect(blocked.isError).toBe(true);
    const blockedText = textOf(blocked);
    expect(blockedText).toContain('HTTP 409');
    expect(blockedText).toContain('Studio');
  });

  it('explains how to reach the daemon when it is not running', async () => {
    const mcpServer = createAgentDevMcpServer({ daemonBaseUrl: 'http://127.0.0.1:1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await client.close();
      await mcpServer.close();
    });

    const result = await client.callTool({ name: 'agent_dev_doctor', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('agent-dev start');
  });
});
