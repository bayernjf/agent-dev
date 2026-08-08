import { describe, expect, it } from 'vitest';
import { discoverAgentRuntimes } from '../src/index.js';

describe('agent runtime catalog', () => {
  it('returns built-in runtimes with detection status', () => {
    const agents = discoverAgentRuntimes();
    expect(agents.every(agent => agent.source === 'built-in')).toBe(true);
    expect(agents.some(agent => agent.id === 'codex')).toBe(true);
    expect(agents.find(agent => agent.id === 'codex')).toMatchObject({ launchCommand: 'codex' });
  });

  it('supports minimal custom Agent configuration', () => {
    const agents = discoverAgentRuntimes([{ name: 'Fixture Agent', launchCommand: 'node' }]);
    expect(agents.at(-1)).toMatchObject({ id: 'custom-1', source: 'custom', name: 'Fixture Agent', launchCommand: 'node', detected: true });
  });
});
