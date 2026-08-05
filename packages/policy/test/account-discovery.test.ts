import { describe, expect, it } from 'vitest';
import { runAccountDiscovery, type CommandRunner } from '../src/index.js';

describe('account discovery', () => {
  it('only reads active local identities and leaves Supabase manual', async () => {
    const runner: CommandRunner = async command => command === 'wrangler'
      ? { exitCode: 1, output: 'Not logged in' }
      : { exitCode: 0, output: `${command}-account` };

    const report = await runAccountDiscovery(runner);

    expect(report.readOnly).toBe(true);
    expect(report.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'github', status: 'authenticated', identity: 'gh-account' }),
      expect.objectContaining({ id: 'cloudflare', status: 'unauthorized' }),
      expect.objectContaining({ id: 'supabase', status: 'manual' }),
    ]));
  });
});
