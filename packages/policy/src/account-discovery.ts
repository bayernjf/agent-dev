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
  // Each CLI states the account in its own shape, so each one gets its own reader. A shared
  // "first useful line" heuristic reported a version banner or a wrapper hint as the account name.
  identify?: (stdout: string) => string | null;
};

function lines(value: string) {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

function githubAccount(stdout: string) {
  return /\baccount (\S+)/.exec(stdout)?.[1] ?? null;
}

function vercelAccount(stdout: string) {
  // `vercel whoami` prints only the account on stdout; the banner goes to stderr.
  return lines(stdout)[0] ?? null;
}

function cloudflareAccount(stdout: string) {
  const row = lines(stdout).find(line => line.startsWith('│') && !line.includes('Account Name'));
  const name = row?.split('│').map(cell => cell.trim()).filter(Boolean)[0];
  if (name) return name;
  return /associated with the email ([^\s.]+)/.exec(stdout)?.[1] ?? null;
}

const definitions: DiscoveryDefinition[] = [
  { id: 'github', title: 'GitHub', command: 'gh', arguments: ['auth', 'status', '--active'], identify: githubAccount },
  { id: 'vercel', title: 'Vercel', command: 'vercel', arguments: ['whoami'], identify: vercelAccount },
  { id: 'cloudflare', title: 'Cloudflare', command: 'wrangler', arguments: ['whoami'], identify: cloudflareAccount },
  { id: 'supabase', title: 'Supabase' },
];

function describe(definition: DiscoveryDefinition, result: CommandResult): AccountDiscovery {
  const { identify: _identify, ...shape } = definition;
  if (result.error?.includes('ENOENT')) {
    return {
      ...shape,
      status: 'missing',
      identity: null,
      detail: `${definition.command} is not installed on this computer.`,
      nextAction: `Install ${definition.command}, then rerun discovery.`,
    };
  }
  if (result.exitCode === 0) {
    return {
      ...shape,
      status: 'authenticated',
      identity: definition.identify?.(result.stdout ?? result.output) ?? null,
      detail: 'Local CLI authentication was confirmed. No account resources were listed or modified.',
      nextAction: 'Choose the target account or organization in the Blueprint, then save a new revision.',
    };
  }
  if (result.exitCode === 1 || result.exitCode === null) {
    return {
      ...shape,
      status: 'unauthorized',
      identity: null,
      detail: 'The local CLI is available but has no usable active session.',
      nextAction: `Sign in with ${definition.command}, then rerun discovery.`,
    };
  }
  return {
    ...shape,
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
