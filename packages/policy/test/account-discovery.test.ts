import { describe, expect, it } from 'vitest';
import { runAccountDiscovery, type CommandRunner } from '../src/index.js';

// Verbatim output captured from the local CLIs on 2026-08-23. The point of using it unedited is
// that each CLI buries the account behind a banner, a table or a wrapper hint on stderr.
const GH_STDOUT = `github.com
  ✓ Logged in to github.com account bayernjf (keyring)
  - Active account: true
  - Git operations protocol: ssh
  - Token: ghp_************************************
`;

const VERCEL_STDOUT = 'bayernjf\n';
const VERCEL_STDERR = `<claude-code-hint v="1" type="plugin" value="vercel@claude-plugins-official" />
Vercel CLI 56.0.0 (Node.js 22.23.1)
`;

const WRANGLER_STDOUT = `
 ⛅️ wrangler 4.86.0 (update available 4.125.0)
──────────────────────────────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email jiangfengkxi@outlook.com.
┌────────────────────────────────────┬──────────────────────────────────┐
│ Account Name                       │ Account ID                       │
├────────────────────────────────────┼──────────────────────────────────┤
│ Jiangfengkxi@outlook.com's Account │ 23afa7f0233653f87dc9ceafd02eb79a │
└────────────────────────────────────┴──────────────────────────────────┘
`;

describe('account discovery', () => {
  it('reports the account each CLI actually names, not the first line it prints', async () => {
    const runner: CommandRunner = async command => {
      if (command === 'gh') return { exitCode: 0, output: GH_STDOUT, stdout: GH_STDOUT, stderr: '' };
      if (command === 'vercel') return { exitCode: 0, output: `${VERCEL_STDERR}${VERCEL_STDOUT}`, stdout: VERCEL_STDOUT, stderr: VERCEL_STDERR };
      return { exitCode: 0, output: WRANGLER_STDOUT, stdout: WRANGLER_STDOUT, stderr: '' };
    };

    const report = await runAccountDiscovery(runner);
    const identities = Object.fromEntries(report.accounts.map(account => [account.id, account.identity]));

    expect(identities).toEqual({
      github: 'bayernjf',
      vercel: 'bayernjf',
      cloudflare: "Jiangfengkxi@outlook.com's Account",
      supabase: null,
    });
    expect(report.readOnly).toBe(true);
  });

  it('only reads active local identities and leaves Supabase manual', async () => {
    const runner: CommandRunner = async command => command === 'wrangler'
      ? { exitCode: 1, output: 'Not logged in' }
      : { exitCode: 0, output: VERCEL_STDOUT, stdout: VERCEL_STDOUT, stderr: '' };

    const report = await runAccountDiscovery(runner);

    expect(report.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cloudflare', status: 'unauthorized', identity: null }),
      expect.objectContaining({ id: 'supabase', status: 'manual', identity: null }),
      expect.objectContaining({ id: 'vercel', status: 'authenticated', identity: 'bayernjf' }),
    ]));
  });

  it('falls back to a merged-stream runner that cannot separate stdout from stderr', async () => {
    const runner: CommandRunner = async () => ({ exitCode: 0, output: VERCEL_STDOUT });
    const report = await runAccountDiscovery(runner);
    expect(report.accounts.find(account => account.id === 'vercel')?.identity).toBe('bayernjf');
  });
});
