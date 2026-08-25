import { describe, expect, it } from 'vitest';
import { discoverAgentRuntimes } from '../src/index.js';

describe('agent runtime catalog', () => {
  it('returns only detected built-in runtimes', () => {
    const agents = discoverAgentRuntimes();
    expect(agents.every(agent => agent.source === 'built-in')).toBe(true);
    expect(agents.every(agent => agent.detected)).toBe(true);
    expect(agents.every(agent => agent.launchCommand.length > 0)).toBe(true);
  });

  it('supports minimal custom Agent configuration', () => {
    const agents = discoverAgentRuntimes([{ name: 'Fixture Agent', launchCommand: 'node' }]);
    expect(agents.at(-1)).toMatchObject({ id: 'custom-1', source: 'custom', name: 'Fixture Agent', launchCommand: 'node', detected: true });
  });

  it('keeps a PATH command visible when its version probe fails', () => {
    const agents = discoverAgentRuntimes([{ name: 'Shell Fixture', launchCommand: 'sh' }]);
    expect(agents.at(-1)).toMatchObject({ detected: true, name: 'Shell Fixture' });
  });

  // A lookup that cannot run is not evidence of absence. This used to take the not-found branch and
  // cache it, so one busy moment disabled an installed Agent in Studio and made the daemon refuse it
  // with a 409 for the rest of the process. Emptying PATH makes `which` itself unresolvable, which is
  // the same failure shape as the timeout that flaked the suite, minus the timing dependency.
  it('reports an unfinished PATH lookup as unknown rather than absent, and does not cache it', () => {
    const command = 'agent-dev-detection-fixture';
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    let inconclusive;
    try {
      inconclusive = discoverAgentRuntimes([{ name: 'Inconclusive', launchCommand: command }]).at(-1);
    } finally {
      process.env.PATH = originalPath;
    }

    expect(inconclusive?.detail).toContain('did not complete');
    expect(inconclusive?.detail).not.toContain('not found');

    // Same command, working PATH: a cached inconclusive result would still say "did not complete".
    const settled = discoverAgentRuntimes([{ name: 'Inconclusive', launchCommand: command }]).at(-1);
    expect(settled?.detail).toBe('Command not found on local PATH.');
  });
});
