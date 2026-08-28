import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export type McpBridgeOptions = {
  daemonBaseUrl: string;
  fetchImpl?: typeof fetch;
};

type DaemonResponse = { ok: boolean; status: number; body: unknown };

const projectIdSchema = {
  projectId: z.string().min(1).describe('Project id as listed by agent_dev_list_projects.'),
};

// The daemon's POST routes require literal confirmation strings. Keeping them on this side of the
// bridge means no MCP client — and no model driving one — can forge, alter, or omit them.
const REQUEST_RELEASE_BODY = { confirmation: 'REQUEST_RELEASE' } as const;

function errorMessage(body: unknown): string {
  return body && typeof body === 'object' && 'error' in body
    ? String((body as Record<string, unknown>).error)
    : JSON.stringify(body);
}

export function createAgentDevMcpServer(options: McpBridgeOptions): McpServer {
  const fetchImpl = options.fetchImpl ?? fetch;

  const callDaemon = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<DaemonResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.daemonBaseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return {
        ok: false,
        status: 0,
        body: { error: `Daemon not reachable at ${options.daemonBaseUrl}. Start it with \`agent-dev start\`.` },
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

  const toResult = ({ ok, status, body }: DaemonResponse) => {
    if (ok) return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] };
    // 409 is how the daemon talks about gates; tell the caller where a human finishes the step.
    const guidance = status === 409
      ? '\nA delivery gate blocks this step. Continue in Studio for this project; approvals and acceptances can only be pressed there by a human.'
      : '';
    return {
      content: [{ type: 'text' as const, text: `Daemon responded with HTTP ${status}: ${errorMessage(body)}${guidance}` }],
      isError: true,
    };
  };

  const server = new McpServer({ name: 'agent-dev', version: '0.1.0-alpha.0' });

  server.registerTool('agent_dev_doctor', {
    title: 'Agent-Dev doctor',
    description: 'Check the local Agent-Dev environment: required commands and connector readiness.',
  }, () => callDaemon('GET', '/api/doctor').then(toResult));

  server.registerTool('agent_dev_list_projects', {
    title: 'List projects',
    description: 'List all Agent-Dev projects with their delivery state.',
  }, () => callDaemon('GET', '/api/projects').then(toResult));

  server.registerTool('agent_dev_get_project', {
    title: 'Get project',
    description: 'Get one project: delivery state and current Blueprint.',
    inputSchema: projectIdSchema,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}`).then(toResult));

  server.registerTool('agent_dev_get_release', {
    title: 'Get release state',
    description: 'Get the production release state of a project: latest release run and recorded evidence.',
    inputSchema: projectIdSchema,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/release`).then(toResult));

  server.registerTool('agent_dev_get_feature_task', {
    title: 'Get feature task',
    description: 'Get the current feature task of a project, if one is defined.',
    inputSchema: projectIdSchema,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/feature-task`).then(toResult));

  server.registerTool('agent_dev_create_project', {
    title: 'Create project',
    description: 'Create a project from a name and Blueprint answers. No external system is touched.',
    inputSchema: {
      name: z.string().trim().min(2).max(80).describe('Product name, 2-80 characters.'),
      answers: z.record(z.string(), z.unknown()).optional().describe('Optional Blueprint answers, e.g. { "mode": "beginner" }.'),
    },
  }, args => callDaemon('POST', '/api/projects', { name: args.name, answers: args.answers }).then(toResult));

  server.registerTool('agent_dev_revise_blueprint', {
    title: 'Revise Blueprint',
    description: 'Revise the Blueprint of a project, creating the next revision. No external system is touched.',
    inputSchema: {
      ...projectIdSchema,
      answers: z.record(z.string(), z.unknown()).describe('The full revised Blueprint answers.'),
    },
  }, args => callDaemon('PUT', `/api/projects/${encodeURIComponent(args.projectId)}/blueprint`, { answers: args.answers }).then(toResult));

  server.registerTool('agent_dev_dry_run', {
    title: 'Dry run',
    description: 'Preview the artifacts a Local Apply would write for the current Blueprint revision. Writes nothing.',
    inputSchema: projectIdSchema,
  }, args => callDaemon('GET', `/api/projects/${encodeURIComponent(args.projectId)}/dry-run`).then(toResult));

  server.registerTool('agent_dev_request_release', {
    title: 'Request a production release',
    description: 'Open the production release gate (REQUEST_RELEASE). This only asks for approval; approving is a human act in Studio and is not available through this MCP server.',
    inputSchema: projectIdSchema,
  }, args => callDaemon('POST', `/api/projects/${encodeURIComponent(args.projectId)}/release/request`, REQUEST_RELEASE_BODY).then(toResult));

  return server;
}

export async function runAgentDevMcp(): Promise<void> {
  const daemonBaseUrl = process.env.AGENT_DEV_DAEMON_URL ?? 'http://127.0.0.1:3737';
  const server = createAgentDevMcpServer({ daemonBaseUrl });
  await server.connect(new StdioServerTransport());
}
