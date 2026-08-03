import { describe, expect, it } from 'vitest';
import { runConnectorPreflight, type CommandRunner } from '../src/index.js';

describe('connector preflight', () => {
  it('reports local availability without checking any account', async () => {
    const runner: CommandRunner = async command => command === 'supabase'
      ? { exitCode: null, output: '', error: 'spawn supabase ENOENT' }
      : { exitCode: 0, output: `${command} 1.0.0` };

    const report = await runConnectorPreflight(runner);

    expect(report.localOnly).toBe(true);
    expect(report.readyForAccountDiscovery).toBe(false);
    expect(report.connectors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'github', status: 'available' }),
      expect.objectContaining({ id: 'supabase', status: 'missing' }),
    ]));
  });
});
