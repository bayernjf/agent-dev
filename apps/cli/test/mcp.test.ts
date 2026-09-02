import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentDevStore } from '@agent-dev/storage';
import { createDaemonApp } from '@agent-dev/daemon';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../package.json';
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

// Connector preflight/account discovery spawn real CLIs by default, and so does the runtime catalog:
// discovery walks all eight built-in commands in sequence with a 5 s version-probe budget each, which
// is more than the 5 s a test is given, so this helper timed out on 2 of 8 full runs while only ever
// meaning to check that the bridge reaches the route. Stub all three and the wiring is still exercised
// end to end — MCP client -> bridge -> HTTP -> daemon route -> store — without probing the machine.
async function startBridgeWithStubbedConnectors(): Promise<Client> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-dev-mcp-'));
  const store = await AgentDevStore.open(join(directory, 'agent-dev.sqlite'));
  const { app } = createDaemonApp(store, undefined, {
    discoverRuntimes: () => [{
      id: 'codex',
      name: 'Codex',
      source: 'built-in',
      launchCommand: 'codex',
      detected: true,
      version: 'fixture',
      detail: 'Detected on local PATH.',
      capabilities: ['workspace-write', 'version-detection', 'non-interactive'],
    }],
    runPreflight: async () => ({
      checkedAt: new Date().toISOString(),
      localOnly: true as const,
      readyForAccountDiscovery: true,
      connectors: [{
        id: 'github',
        title: 'GitHub',
        command: 'gh',
        status: 'available',
        version: '1.0.0',
        detail: 'fixture',
        nextAction: 'none',
      }],
    }),
    runAccountDiscovery: async () => ({
      checkedAt: new Date().toISOString(),
      readOnly: true as const,
      accounts: [{
        id: 'github',
        title: 'GitHub',
        status: 'authenticated',
        identity: 'fixture',
        detail: 'fixture',
        nextAction: 'none',
      }],
    }),
  });
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
      'agent_dev_create_feature_task',
      'agent_dev_create_project',
      'agent_dev_doctor',
      'agent_dev_dry_run',
      'agent_dev_get_acceptance',
      'agent_dev_get_apply',
      'agent_dev_get_baseline_plan',
      'agent_dev_get_connectors',
      'agent_dev_get_credentials_meta',
      'agent_dev_get_delivery_report',
      'agent_dev_get_feature_task',
      'agent_dev_get_project',
      'agent_dev_get_quality_gate',
      'agent_dev_get_release',
      'agent_dev_get_release_plan',
      'agent_dev_get_runtime',
      'agent_dev_list_projects',
      'agent_dev_request_release',
      'agent_dev_revise_blueprint',
      'agent_dev_submit_acceptance',
    ]);
    // Acceptance submissions are exposed by design; the approval acts never are.
    expect(names.some(name => name.includes('approve'))).toBe(false);

    // Clients decide whether to ask a human before running a tool from these hints alone.
    expect(tools.every(tool => tool.annotations !== undefined)).toBe(true);
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    expect(byName.get('agent_dev_list_projects')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get('agent_dev_dry_run')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('agent_dev_get_connectors')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(byName.get('agent_dev_request_release')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('agent_dev_create_feature_task')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('agent_dev_submit_acceptance')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

    expect(client.getServerVersion()).toMatchObject({ name: 'agent-dev', version: packageJson.version });
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
    type Manifest = { plan: { artifactCount: number; artifacts: { id: string; path: string; bytes: number; content?: string }[] } };
    const manifest = JSON.parse(textOf(dryRun)) as Manifest;
    expect(manifest.plan.artifactCount).toBeGreaterThan(0);
    expect(manifest.plan.artifacts.every(artifact => artifact.content === undefined)).toBe(true);

    const artifactId = manifest.plan.artifacts[0].id;
    const fullArtifact = await client.callTool({ name: 'agent_dev_dry_run', arguments: { projectId: project.id, artifactId } });
    expect(fullArtifact.isError).toBeFalsy();
    const content = JSON.parse(textOf(fullArtifact)) as { plan: { artifact: { id: string; path: string; content: string } } };
    expect(content.plan.artifact.id).toBe(artifactId);
    expect(content.plan.artifact.content.length).toBeGreaterThan(0);

    const missingArtifact = await client.callTool({ name: 'agent_dev_dry_run', arguments: { projectId: project.id, artifactId: 'no-such-file' } });
    expect(missingArtifact.isError).toBe(true);
    expect(textOf(missingArtifact)).toContain('no-such-file');

    const featureTask = await client.callTool({ name: 'agent_dev_get_feature_task', arguments: { projectId: project.id } });
    expect(featureTask.isError).toBeFalsy();
    expect(JSON.parse(textOf(featureTask))).toMatchObject({ task: null });

    const apply = await client.callTool({ name: 'agent_dev_get_apply', arguments: { projectId: project.id } });
    expect(apply.isError).toBeFalsy();
    expect(JSON.parse(textOf(apply))).toMatchObject({ run: null });

    const quality = await client.callTool({ name: 'agent_dev_get_quality_gate', arguments: { projectId: project.id } });
    expect(quality.isError).toBeFalsy();
    expect(JSON.parse(textOf(quality))).toMatchObject({ result: null });

    const acceptance = await client.callTool({ name: 'agent_dev_get_acceptance', arguments: { projectId: project.id } });
    expect(acceptance.isError).toBeFalsy();
    expect(JSON.parse(textOf(acceptance))).toMatchObject({ acceptance: null });

    const report = await client.callTool({ name: 'agent_dev_get_delivery_report', arguments: { projectId: project.id } });
    expect(report.isError).toBeFalsy();
    expect(textOf(report)).toContain('MCP Probe Final Delivery Report');

    const baselinePlan = await client.callTool({ name: 'agent_dev_get_baseline_plan', arguments: { projectId: project.id } });
    expect(baselinePlan.isError).toBeFalsy();
    expect(JSON.parse(textOf(baselinePlan))).toMatchObject({ plan: { noExternalChanges: true } });

    const credentialsMeta = await client.callTool({ name: 'agent_dev_get_credentials_meta', arguments: {} });
    expect(credentialsMeta.isError).toBeFalsy();
    const meta = JSON.parse(textOf(credentialsMeta)) as { meta: { keys: string[] } };
    expect(Array.isArray(meta.meta.keys)).toBe(true);

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

    // The same gates protect the two progress tools: a feature task needs a completed Apply, and
    // acceptance needs an approved feature task. The bridge must refuse both, not forge them.
    const taskBlocked = await client.callTool({
      name: 'agent_dev_create_feature_task',
      arguments: { projectId: project.id, title: 'Add receipt list', objective: 'Show saved receipts to the user.', acceptanceCriteria: ['The list renders saved receipts.'] },
    });
    expect(taskBlocked.isError).toBe(true);
    expect(textOf(taskBlocked)).toContain('HTTP 409');

    const acceptanceBlocked = await client.callTool({
      name: 'agent_dev_submit_acceptance',
      arguments: { projectId: project.id, summary: 'Everything works as specified.', criteriaConfirmed: true },
    });
    expect(acceptanceBlocked.isError).toBe(true);
    expect(textOf(acceptanceBlocked)).toContain('HTTP 409');
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

  it('gives up on a daemon that accepts the request but never answers', async () => {
    // A hung process looks exactly like a slow one to fetch, so the bridge owns the deadline.
    const fetchImpl = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const mcpServer = createAgentDevMcpServer({ daemonBaseUrl: 'http://127.0.0.1:3737', fetchImpl, timeoutMs: 50 });
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
    expect(textOf(result)).toContain('did not answer within 50 ms');
  });

  it('covers the remaining read tools: runtime, connectors, release, release plan', async () => {
    const client = await startBridgeWithStubbedConnectors();
    const created = await client.callTool({ name: 'agent_dev_create_project', arguments: { name: 'Read Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; state: string } };

    // Runtime catalog + profiles are a single combined read from the bridge.
    const runtime = await client.callTool({ name: 'agent_dev_get_runtime', arguments: {} });
    expect(runtime.isError).toBeFalsy();
    const runtimeBody = JSON.parse(textOf(runtime)) as { agents?: unknown[]; profiles?: unknown[] };
    expect(Array.isArray(runtimeBody.agents)).toBe(true);
    expect(Array.isArray(runtimeBody.profiles)).toBe(true);

    // Connector preflight + account discovery are combined into one read.
    const connectors = await client.callTool({ name: 'agent_dev_get_connectors', arguments: {} });
    expect(connectors.isError).toBeFalsy();
    const connectorBody = JSON.parse(textOf(connectors)) as { preflight?: unknown; discovery?: unknown };
    expect(connectorBody.preflight).toBeDefined();
    expect(connectorBody.discovery).toBeDefined();

    // Release state is a read of the current run + evidence; a fresh project has none.
    const release = await client.callTool({ name: 'agent_dev_get_release', arguments: { projectId: project.id } });
    expect(release.isError).toBeFalsy();
    const releaseBody = JSON.parse(textOf(release)) as { state: string; releaseRun: unknown; evidence: unknown };
    expect(releaseBody.state).toBe('NEEDS_INPUT');
    expect(releaseBody.releaseRun).toBeNull();
    expect(releaseBody.evidence).toBeNull();

    // Release plan requires a completed Apply; the bridge must surface the 409 gate, not forge a plan.
    const releasePlan = await client.callTool({ name: 'agent_dev_get_release_plan', arguments: { projectId: project.id } });
    expect(releasePlan.isError).toBe(true);
    expect(textOf(releasePlan)).toContain('HTTP 409');

    // Unknown project for release read -> 404 surfaced as an error.
    const missing = await client.callTool({ name: 'agent_dev_get_release', arguments: { projectId: 'missing' } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('HTTP 404');
  });

  it('revises a Blueprint through the bridge and surfaces invalid answers', async () => {
    const client = await startBridge();
    const created = await client.callTool({ name: 'agent_dev_create_project', arguments: { name: 'Revise Probe', answers: { mode: 'beginner' } } });
    const { project } = JSON.parse(textOf(created)) as { project: { id: string; blueprint: { metadata: { revision: number } } } };
    expect(project.blueprint.metadata.revision).toBe(1);

    // Revising with the full answers creates the next revision without touching any external system.
    const revised = await client.callTool({
      name: 'agent_dev_revise_blueprint',
      arguments: { projectId: project.id, answers: { mode: 'professional' } },
    });
    expect(revised.isError).toBeFalsy();
    const revisedBody = JSON.parse(textOf(revised)) as { project: { blueprint: { metadata: { revision: number } } } };
    expect(revisedBody.project.blueprint.metadata.revision).toBe(2);

    // A project that does not exist is reported as a 404, never silently ignored.
    const missing = await client.callTool({ name: 'agent_dev_revise_blueprint', arguments: { projectId: 'missing', answers: { mode: 'professional' } } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('HTTP 404');
  });
});
