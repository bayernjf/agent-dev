import { spawnSync } from 'node:child_process';

const online = process.argv.includes('--online');
const timeout = 30_000;

const tools = [
  { name: 'codex', versionArgs: ['--version'] },
  { name: 'gh', versionArgs: ['--version'], authArgs: ['auth', 'status'] },
  { name: 'vercel', versionArgs: ['--version'], authArgs: ['whoami'] },
  { name: 'wrangler', versionArgs: ['--version'], authArgs: ['whoami'] },
  { name: 'supabase', versionArgs: ['--version'], authArgs: ['projects', 'list'] },
];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  return {
    available: !result.error || result.error.code === 'ETIMEDOUT',
    succeeded: result.status === 0,
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

const results = tools.map(tool => {
  const version = run(tool.name, tool.versionArgs);
  const auth = online && version.available && tool.authArgs ? run(tool.name, tool.authArgs) : null;
  return {
    tool: tool.name,
    installed: version.available && version.succeeded,
    authenticated: auth ? auth.succeeded : null,
    authCheckTimedOut: auth ? auth.timedOut : false,
  };
});

process.stdout.write(`${JSON.stringify({ mode: online ? 'online' : 'offline', tools: results }, null, 2)}\n`);
