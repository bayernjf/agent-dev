/**
 * Environment doctor: diagnose common setup issues for external users.
 *
 * Based on real-world lessons from v0.1: Node version, agent CLI,
 * Git/GitHub auth, Vercel/Cloudflare auth, proxy, network connectivity.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// On Windows, npm/npx are .cmd shims and Node (since the CVE-2024-27980 fix) refuses to spawn
// them without a shell. All call sites pass fixed literal arguments, so shell: true is safe.
const npmSpawnOptions = process.platform === 'win32' ? { shell: true } : {};

export type DoctorCheckStatus = 'pass' | 'fail' | 'warning' | 'unknown';

export type DoctorCheck = {
  id: string;
  category: 'node' | 'git' | 'github' | 'agent' | 'platform' | 'network' | 'proxy';
  title: string;
  status: DoctorCheckStatus;
  message: string;
  remediation?: string[];
  details?: Record<string, unknown>;
};

export type DoctorReport = {
  timestamp: string;
  overallStatus: 'healthy' | 'issues-found' | 'unknown';
  checks: DoctorCheck[];
  summary: {
    pass: number;
    fail: number;
    warning: number;
    unknown: number;
  };
};

// ---------------------------------------------------------------------------
// Individual check functions
// ---------------------------------------------------------------------------

async function checkNodeVersion(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('node', ['--version']);
    const version = stdout.trim().replace('v', '');
    const major = parseInt(version.split('.')[0] ?? '0', 10);
    if (major >= 22) {
      return { id: 'node-version', category: 'node', title: 'Node.js version', status: 'pass', message: `Node.js ${version} detected (requires >=22)`, details: { version } };
    }
    return {
      id: 'node-version', category: 'node', title: 'Node.js version', status: 'fail',
      message: `Node.js ${version} detected, but version 22 or newer is required`,
      remediation: [
        'Install Node.js 22 or newer',
        'If using fnm: `fnm install 22 && fnm use 22`',
        'If using nvm: `nvm install 22 && nvm use 22`',
        'Restart the Agent-Dev daemon after switching versions',
      ],
      details: { version, required: '>=22' },
    };
  } catch {
    return {
      id: 'node-version', category: 'node', title: 'Node.js version', status: 'fail',
      message: 'Node.js is not installed or not on PATH',
      remediation: ['Install Node.js 22 or newer from https://nodejs.org', 'Verify with `node --version`'],
    };
  }
}

async function checkNpmVersion(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('npm', ['--version'], npmSpawnOptions);
    return { id: 'npm-version', category: 'node', title: 'npm version', status: 'pass', message: `npm ${stdout.trim()} detected`, details: { version: stdout.trim() } };
  } catch {
    return { id: 'npm-version', category: 'node', title: 'npm version', status: 'fail', message: 'npm is not available', remediation: ['Reinstall Node.js (npm comes bundled with Node.js)'] };
  }
}

async function checkGit(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return { id: 'git', category: 'git', title: 'Git', status: 'pass', message: stdout.trim(), details: { version: stdout.trim() } };
  } catch {
    return { id: 'git', category: 'git', title: 'Git', status: 'fail', message: 'Git is not installed or not on PATH', remediation: ['Install Git: https://git-scm.com/download/mac', 'Or: `brew install git`'] };
  }
}

async function checkGitHubAuth(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'status']);
    const authenticated = stdout.includes('Logged in');
    if (authenticated) {
      const usernameMatch = stdout.match(/as ([\w-]+)/);
      return { id: 'github-auth', category: 'github', title: 'GitHub authentication', status: 'pass', message: `Authenticated to GitHub${usernameMatch ? ` as ${usernameMatch[1]}` : ''}`, details: { output: stdout.trim() } };
    }
    return { id: 'github-auth', category: 'github', title: 'GitHub authentication', status: 'warning', message: 'GitHub CLI is installed but not authenticated', remediation: ['Run `gh auth login` to authenticate with GitHub'] };
  } catch {
    return { id: 'github-auth', category: 'github', title: 'GitHub authentication', status: 'warning', message: 'GitHub CLI (gh) is not installed — PR creation will require manual steps', remediation: ['Install GitHub CLI: `brew install gh`', 'Then run `gh auth login`'] };
  }
}

async function checkAgentCli(agentId: string, command: string, installHint: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync(command, ['--version']);
    return { id: `agent-${agentId}`, category: 'agent', title: `${agentId} CLI`, status: 'pass', message: `${agentId} ${stdout.trim()} detected`, details: { version: stdout.trim() } };
  } catch {
    return { id: `agent-${agentId}`, category: 'agent', title: `${agentId} CLI`, status: 'warning', message: `${agentId} CLI is not installed or not on PATH`, remediation: [installHint] };
  }
}

async function checkVercelAuth(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('vercel', ['whoami']);
    return { id: 'vercel-auth', category: 'platform', title: 'Vercel authentication', status: 'pass', message: `Authenticated to Vercel as ${stdout.trim()}`, details: { user: stdout.trim() } };
  } catch {
    return { id: 'vercel-auth', category: 'platform', title: 'Vercel authentication', status: 'warning', message: 'Vercel CLI is not installed or not authenticated — API deployment will require manual steps', remediation: ['Install Vercel CLI: `npm install -g vercel`', 'Then run `vercel login`'] };
  }
}

async function checkCloudflareWrangler(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('npx', ['wrangler', '--version'], npmSpawnOptions);
    return { id: 'cloudflare-wrangler', category: 'platform', title: 'Cloudflare Wrangler', status: 'pass', message: `Wrangler ${stdout.trim()} available via npx`, details: { version: stdout.trim() } };
  } catch {
    return { id: 'cloudflare-wrangler', category: 'platform', title: 'Cloudflare Wrangler', status: 'warning', message: 'Cloudflare Wrangler is not available — Pages deployment will require manual steps', remediation: ['Wrangler is usually installed as a project dependency', 'If needed globally: `npm install -g wrangler`'] };
  }
}

async function checkProxy(): Promise<DoctorCheck> {
  const httpProxy = process.env.HTTP_PROXY ?? process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  const nodeUseEnvProxy = process.env.NODE_USE_ENV_PROXY;

  if (httpsProxy || httpProxy) {
    return {
      id: 'proxy', category: 'proxy', title: 'Proxy configuration', status: 'pass',
      message: `Proxy configured${httpsProxy ? ` (HTTPS: ${httpsProxy})` : ''}${httpProxy ? ` (HTTP: ${httpProxy})` : ''}`,
      details: { httpProxy, httpsProxy, noProxy, nodeUseEnvProxy },
    };
  }
  return {
    id: 'proxy', category: 'proxy', title: 'Proxy configuration', status: 'unknown',
    message: 'No proxy configured. If you are behind a corporate proxy, set HTTPS_PROXY and NODE_USE_ENV_PROXY=1',
    remediation: ['If behind a proxy: `export HTTPS_PROXY=http://your-proxy:port`', 'Set `export NODE_USE_ENV_PROXY=1` for Node.js to respect proxy settings'],
    details: { httpProxy, httpsProxy, noProxy, nodeUseEnvProxy },
  };
}

async function checkNetwork(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', 'https://github.com']);
    const statusCode = parseInt(stdout, 10);
    if (statusCode >= 200 && statusCode < 500) {
      return { id: 'network-github', category: 'network', title: 'Network: GitHub', status: 'pass', message: `GitHub reachable (HTTP ${statusCode})`, details: { statusCode } };
    }
    return { id: 'network-github', category: 'network', title: 'Network: GitHub', status: 'fail', message: `GitHub returned unexpected status: ${statusCode}`, remediation: ['Check your internet connection', 'If behind a proxy, ensure HTTPS_PROXY is set'] };
  } catch {
    return { id: 'network-github', category: 'network', title: 'Network: GitHub', status: 'fail', message: 'Cannot reach GitHub — check your internet connection or proxy settings', remediation: ['Check internet connection', 'Verify proxy settings if behind corporate firewall', 'Try `curl -v https://github.com` for details'] };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all environment checks and return a comprehensive doctor report.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkNpmVersion(),
    checkGit(),
    checkGitHubAuth(),
    checkAgentCli('codex', 'codex', 'Install Codex: `npm install -g @openai/codex`'),
    checkAgentCli('claude-code', 'claude', 'Install Claude Code: `npm install -g @anthropic-ai/claude-code`'),
    checkAgentCli('opencode', 'opencode', 'Install OpenCode: follow guide at https://opencode.ai'),
    checkVercelAuth(),
    checkCloudflareWrangler(),
    checkProxy(),
    checkNetwork(),
  ]);

  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    fail: checks.filter(c => c.status === 'fail').length,
    warning: checks.filter(c => c.status === 'warning').length,
    unknown: checks.filter(c => c.status === 'unknown').length,
  };

  const overallStatus: DoctorReport['overallStatus'] =
    summary.fail > 0 ? 'issues-found' :
    summary.warning > 0 ? 'issues-found' :
    summary.pass > 0 ? 'healthy' : 'unknown';

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    checks,
    summary,
  };
}

/**
 * Get a human-readable summary of the doctor report.
 */
export function formatDoctorSummary(report: DoctorReport): string {
  const lines = [
    `Agent-Dev Environment Doctor (${report.timestamp})`,
    `Overall: ${report.overallStatus.toUpperCase()}`,
    ``,
    `  Pass:    ${report.summary.pass}`,
    `  Fail:    ${report.summary.fail}`,
    `  Warning: ${report.summary.warning}`,
    `  Unknown: ${report.summary.unknown}`,
    ``,
  ];

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : check.status === 'warning' ? '!' : '?';
    lines.push(`  ${icon} [${check.category}] ${check.title}: ${check.message}`);
    if (check.remediation && check.status !== 'pass') {
      for (const step of check.remediation) {
        lines.push(`      → ${step}`);
      }
    }
  }

  return lines.join('\n');
}
