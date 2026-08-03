import { spawnSync } from 'node:child_process';
import { runConnectorPreflight } from '@agent-dev/policy';
import { startDaemon } from '@agent-dev/daemon';

type Check = {
  command: string;
  available: boolean;
  version: string | null;
};

const commands = ['git', 'node', 'npm', 'gh', 'vercel', 'wrangler', 'supabase', 'codex'] as const;

function checkCommand(command: (typeof commands)[number]): Check {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return {
    command,
    available: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
  };
}

async function main() {
  const command = process.argv[2];
  if (command === 'doctor') {
    const checks = commands.map(checkCommand);
    const connectors = await runConnectorPreflight();
    console.log(JSON.stringify({
      checks,
      connectors,
      ready: checks.every(check => check.available) && connectors.readyForAccountDiscovery,
    }, null, 2));
    return;
  }

  if (command === 'start') {
    const { port, databasePath } = await startDaemon();
    console.log(JSON.stringify({ status: 'running', port, databasePath }, null, 2));
    return;
  }

  console.log('Usage: agent-dev <doctor|start>');
  process.exitCode = 1;
}

void main();
