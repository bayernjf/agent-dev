import { spawnSync } from 'node:child_process';

const online = process.argv.includes('--online');
const timeout = 30_000;

const tools = [
  { name: 'codex', versionArgs: ['--version'] },
  { name: 'gh', versionArgs: ['--version'], authArgs: ['auth', 'status'] },
  { name: 'vercel', versionArgs: ['--version'], authArgs: ['whoami'] },
  { name: 'wrangler', versionArgs: ['--version'], authArgs: ['whoami'] },
  {
    name: 'supabase',
    versionArgs: ['--version'],
    authArgs: ['projects', 'list'],
    boundarySafe: false,
    blockedReason: 'requires-out-of-workspace-local-state',
  },
];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    env: {
      ...process.env,
      SUPABASE_UPDATE_CHECK: 'false',
      WRANGLER_LOG: 'none',
    },
  });
  return {
    available: !result.error || result.error.code === 'ETIMEDOUT',
    succeeded: result.status === 0,
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

const results = tools.map(tool => {
  const resolution = run('which', [tool.name]);
  const installed = resolution.succeeded;
  const version = installed && tool.boundarySafe !== false ? run(tool.name, tool.versionArgs) : null;
  const usable = installed && Boolean(version?.succeeded);
  const auth = online && usable && tool.authArgs ? run(tool.name, tool.authArgs) : null;
  return {
    tool: tool.name,
    installed,
    usableWithinCurrentBoundary: usable,
    authenticated: auth ? auth.succeeded : null,
    authCheckTimedOut: auth ? auth.timedOut : false,
    blockedReason: installed && tool.boundarySafe === false ? tool.blockedReason : null,
  };
});

process.stdout.write(`${JSON.stringify({ mode: online ? 'online' : 'offline', tools: results }, null, 2)}\n`);
