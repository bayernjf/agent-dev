import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export type McpBridgeOptions = {
  daemonBaseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type DaemonResponse = { ok: boolean; status: number; body: unknown };
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

// Bundling-free launch means this file is loaded from src or dist of the same package, so the
// version always belongs to the package.json sitting next to it.
const serverVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const projectIdSchema = {
  projectId: z.string().min(1).describe('Project id as listed by agent_dev_list_projects.'),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

// The daemon's POST routes require literal confirmation strings. Keeping them on this side of the
// bridge means no MCP client — and no model driving one — can forge, alter, or omit them.
const REQUEST_RELEASE_BODY = { confirmation: 'REQUEST_RELEASE' } as const;

function errorMessage(body: unknown): string {
  return body && typeof body === 'object' && 'error' in body
    ? String((body as Record<string, unknown>).error)
    : JSON.stringify(body);
}

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

type GeneratedArtifact = { id: string; title: string; path: string; content: string };

function parseDryRun(body: unknown): { envelope: Record<string, unknown>; plan: Record<string, unknown>; artifacts: GeneratedArtifact[] } | null {
  if (!body || typeof body !== 'object') return null;
  const plan = (body as { plan?: unknown }).plan;
  if (!plan || typeof plan !== 'object') return null;
  const artifacts = (plan as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) return null;
  return {
    envelope: body as Record<string, unknown>,
    plan: plan as Record<string, unknown>,
    artifacts: artifacts.filter(
      (artifact): artifact is GeneratedArtifact =>
        !!artifact && typeof artifact === 'object' && typeof (artifact as GeneratedArtifact).content === 'string',
    ),
  };
}

// A dry run renders every file the Local Apply would write; returning those bodies costs 60-75%
// more payload than the manifest. Callers get the manifest and pull one artifact when they need it.
function toDryRunResult(body: unknown, artifactId?: string): ToolResult {
  const parsed = parseDryRun(body);
  if (!parsed) return jsonResult(body);
  const { envelope, plan, artifacts } = parsed;
  if (artifactId === undefined) {
    return jsonResult({
      ...envelope,
      plan: {
        ...plan,
        artifactCount: artifacts.length,
        artifacts: artifacts.map(artifact => ({
          id: artifact.id,
          title: artifact.title,
          path: artifact.path,
          bytes: Buffer.byteLength(artifact.content, 'utf8'),
        })),
      },
    });
  }
  const artifact = artifacts.find(candidate => candidate.id === artifactId || candidate.path === artifactId);
  if (!artifact) {
    return errorResult(`The dry run has no artifact "${artifactId}". Call agent_dev_dry_run without artifactId to list every id.`);
  }
  return jsonResult({ ...envelope, plan: { blueprintRevision: plan.blueprintRevision, artifact } });
}

export function createAgentDevMcpServer(options: McpBridgeOptions): McpServer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const callDaemon = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<DaemonResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.daemonBaseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const name = cause && typeof cause === 'object' && 'name' in cause ? String((cause as { name: unknown }).name) : '';
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      return {
        ok: false,
        status: 0,
        body: {
          error: timedOut
            ? `The daemon at ${options.daemonBaseUrl} did not answer within ${timeoutMs} ms. It may be busy with another run; try again shortly.`
            : `Daemon not reachable at ${options.daemonBaseUrl}. Start it with \`agent-dev start\`.`,
        },
      };
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { ok: response.ok, status: response.status, body: parsed };
  };

  const toResult = ({ ok, status, body }: DaemonResponse): ToolResult => {
    if (ok) return jsonResult(body);
    // 409 is how the daemon talks about gates; tell the caller where a human finishes the step.
    const guidance = status === 409
      ? '\nA delivery gate blocks this step. Continue in Studio for this project; approvals and acceptances can only be pressed there by a human.'
      : '';
    return errorResult(`Daemon responded with HTTP ${status}: ${errorMessage(body)}${guidance}`);
  };

  const server = new McpServer({ name: 'agent-dev', version: serverVersion });

  server.registerTool('agent_dev_doctor', {
    title: 'Agent-Dev doctor',
    description: 'Check the local Agent-Dev environment: required commands and connector readiness.',
    annotations: READ_ONLY,
  }, () => callDaemon('GET', '/api/doctor').then(toResult));

  server.registerTool('agent_dev_list_projects', {
    title: 'List projects',
    description: 'List all Agent-Dev projects with their delivery state.',
    annotations: READ_ONLY,
  }, () => callDaemon('GET', '/api/projects').then(toResult));

  server.registerTool('agent_dev_get_project', {
    title: 'Get project',
    description: 'Get one project: delivery state and current Blueprint.',
    inputSchema: projectIdSchema,
    annotations: READ_ONLY,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}`).then(toResult));

  server.registerTool('agent_dev_get_release', {
    title: 'Get release state',
    description: 'Get the production release state of a project: latest release run and recorded evidence.',
    inputSchema: projectIdSchema,
    annotations: READ_ONLY,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/release`).then(toResult));

  server.registerTool('agent_dev_get_feature_task', {
    title: 'Get feature task',
    description: 'Get the current feature task of a project, if one is defined.',
    inputSchema: projectIdSchema,
    annotations: READ_ONLY,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/feature-task`).then(toResult));

  server.registerTool('agent_dev_create_project', {
    title: 'Create project',
    description: 'Create a project from a name and Blueprint answers. No external system is touched.',
    inputSchema: {
      name: z.string().trim().min(2).max(80).describe('Product name, 2-80 characters.'),
      answers: z.record(z.string(), z.unknown()).optional().describe('Optional Blueprint answers, e.g. { "mode": "beginner" }.'),
    },
    annotations: ADDITIVE,
  }, args => callDaemon('POST', '/api/projects', { name: args.name, answers: args.answers }).then(toResult));

  server.registerTool('agent_dev_revise_blueprint', {
    title: 'Revise Blueprint',
    description: 'Revise the Blueprint of a project, creating the next revision. No external system is touched.',
    inputSchema: {
      ...projectIdSchema,
      answers: z.record(z.string(), z.unknown()).describe('The full revised Blueprint answers.'),
    },
    annotations: ADDITIVE,
  }, args => callDaemon('PUT', `/api/projects/${encodeURIComponent(args.projectId)}/blueprint`, { answers: args.answers }).then(toResult));

  server.registerTool('agent_dev_dry_run', {
    title: 'Dry run',
    description: 'Preview what a Local Apply would write for the current Blueprint revision: a manifest of artifact ids, titles, paths and sizes, never the file contents themselves. Pass artifactId to read one artifact in full. Writes nothing.',
    inputSchema: {
      ...projectIdSchema,
      artifactId: z.string().min(1).optional().describe('Return the full content of exactly one artifact, identified by an id or path from the manifest.'),
    },
    annotations: READ_ONLY,
  }, async args => {
    const response = await callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/dry-run`);
    return response.ok ? toDryRunResult(response.body, args.artifactId) : toResult(response);
  });

  server.registerTool('agent_dev_request_release', {
    title: 'Request a production release',
    description: 'Open the production release gate (REQUEST_RELEASE). This only asks for approval; approving is a human act in Studio and is not available through this MCP server.',
    inputSchema: projectIdSchema,
    annotations: ADDITIVE,
  }, args => callDaemon('POST', `/api/projects/${encodeURIComponent(args.projectId)}/release/request`, REQUEST_RELEASE_BODY).then(toResult));

  return server;
}

export async function runAgentDevMcp(): Promise<void> {
  const daemonBaseUrl = process.env.AGENT_DEV_DAEMON_URL ?? 'http://127.0.0.1:3737';
  const server = createAgentDevMcpServer({ daemonBaseUrl });
  await server.connect(new StdioServerTransport());
}
