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
});
