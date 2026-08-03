import { spawn } from 'node:child_process';

export type ConnectorId = 'github' | 'supabase' | 'cloudflare' | 'vercel' | 'codex';
export type ConnectorStatus = 'available' | 'missing' | 'error';

export type CommandResult = {
  exitCode: number | null;
  output: string;
  error?: string;
};

export type CommandRunner = (command: string, arguments_: string[]) => Promise<CommandResult>;

export type ConnectorPreflight = {
  id: ConnectorId;
  title: string;
  command: string;
  status: ConnectorStatus;
  version: string | null;
  detail: string;
  nextAction: string;
};

export type ConnectorPreflightReport = {
  checkedAt: string;
  localOnly: true;
  readyForAccountDiscovery: boolean;
  connectors: ConnectorPreflight[];
};

const definitions: Array<Pick<ConnectorPreflight, 'id' | 'title' | 'command'>> = [
  { id: 'github', title: 'GitHub', command: 'gh' },
  { id: 'supabase', title: 'Supabase', command: 'supabase' },
  { id: 'cloudflare', title: 'Cloudflare Pages', command: 'wrangler' },
  { id: 'vercel', title: 'Vercel Functions', command: 'vercel' },
  { id: 'codex', title: 'Codex Runtime', command: 'codex' },
];

export const runLocalCommand: CommandRunner = (command, arguments_) => new Promise(resolve => {
  const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  child.on('error', error => resolve({ exitCode: null, output: '', error: error.message }));
  child.on('close', exitCode => resolve({ exitCode, output: output.trim() }));
});

function firstLine(value: string) {
  return value.split('\n').map(line => line.trim()).find(Boolean) ?? null;
}

function describeResult(definition: (typeof definitions)[number], result: CommandResult): ConnectorPreflight {
  if (result.error?.includes('ENOENT')) {
    return {
      ...definition,
      status: 'missing',
      version: null,
      detail: `${definition.command} is not installed on this computer.`,
      nextAction: `Install ${definition.command}, then run the local preflight again.`,
    };
  }
  if (result.exitCode === 0) {
    return {
      ...definition,
      status: 'available',
      version: firstLine(result.output),
      detail: 'Local command detected. Account authorization has not been checked.',
      nextAction: `When ready, authorize ${definition.title} for account discovery.`,
    };
  }
  return {
    ...definition,
    status: 'error',
    version: firstLine(result.output),
    detail: `Unable to verify ${definition.command} locally without further action.`,
    nextAction: `Repair or reinstall ${definition.command}, then rerun the local preflight.`,
  };
}

export async function runConnectorPreflight(runner: CommandRunner = runLocalCommand): Promise<ConnectorPreflightReport> {
  const connectors = await Promise.all(definitions.map(async definition =>
    describeResult(definition, await runner(definition.command, ['--version'])),
  ));
  return {
    checkedAt: new Date().toISOString(),
    localOnly: true,
    readyForAccountDiscovery: connectors.every(connector => connector.status === 'available'),
    connectors,
  };
}
