import type { CommandResult, CommandRunner, ConnectorId } from './connectors.js';
import { runLocalCommand } from './connectors.js';

export type AccountDiscoveryStatus = 'authenticated' | 'missing' | 'unauthorized' | 'manual' | 'error';

export type AccountDiscovery = {
  id: Extract<ConnectorId, 'github' | 'supabase' | 'cloudflare' | 'vercel'>;
  title: string;
  status: AccountDiscoveryStatus;
  identity: string | null;
  detail: string;
  nextAction: string;
};

export type AccountDiscoveryReport = {
  checkedAt: string;
  readOnly: true;
  accounts: AccountDiscovery[];
};

type DiscoveryDefinition = {
  id: AccountDiscovery['id'];
  title: string;
  command?: string;
  arguments?: string[];
};

const definitions: DiscoveryDefinition[] = [
  { id: 'github', title: 'GitHub', command: 'gh', arguments: ['auth', 'status', '--active'] },
  { id: 'vercel', title: 'Vercel', command: 'vercel', arguments: ['whoami'] },
  { id: 'cloudflare', title: 'Cloudflare', command: 'wrangler', arguments: ['whoami'] },
  { id: 'supabase', title: 'Supabase' },
];

function firstUsefulLine(value: string) {
  return value.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('✓')) ?? null;
}

function describe(definition: DiscoveryDefinition, result: CommandResult): AccountDiscovery {
  if (result.error?.includes('ENOENT')) {
    return {
      ...definition,
      status: 'missing',
      identity: null,
      detail: `${definition.command} is not installed on this computer.`,
      nextAction: `Install ${definition.command}, then rerun discovery.`,
    };
  }
  if (result.exitCode === 0) {
    return {
      ...definition,
      status: 'authenticated',
      identity: firstUsefulLine(result.output),
      detail: 'Local CLI authentication was confirmed. No account resources were listed or modified.',
      nextAction: 'Choose the target account or organization in the Blueprint, then save a new revision.',
    };
  }
  if (result.exitCode === 1 || result.exitCode === null) {
    return {
      ...definition,
      status: 'unauthorized',
      identity: null,
      detail: 'The local CLI is available but has no usable active session.',
      nextAction: `Sign in with ${definition.command}, then rerun discovery.`,
    };
  }
  return {
    ...definition,
    status: 'error',
    identity: null,
    detail: 'The local CLI could not complete a safe identity check.',
    nextAction: `Repair ${definition.command}, then rerun discovery.`,
  };
}

export async function runAccountDiscovery(runner: CommandRunner = runLocalCommand): Promise<AccountDiscoveryReport> {
  const accounts = await Promise.all(definitions.map(async definition => {
    if (!definition.command) {
      const manual: AccountDiscovery = {
        id: 'supabase',
        title: 'Supabase',
        status: 'manual' as const,
        identity: null,
        detail: 'Supabase discovery is intentionally manual in this phase because its CLI may create local state outside the project boundary.',
        nextAction: 'Sign in through Supabase, then enter the intended organization in the Blueprint.',
      };
      return manual;
    }
    return describe(definition, await runner(definition.command, definition.arguments ?? []));
  }));
  return { checkedAt: new Date().toISOString(), readOnly: true, accounts };
}
