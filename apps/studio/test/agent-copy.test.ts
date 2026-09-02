import { describe, expect, it } from 'vitest';
import { agentCopyKeys } from '../src/lib/agent-copy';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import { resolveKey } from './key-resolution';

describe('agent copy key table', () => {
  const agentIds = ['codex', 'claude-code', 'aider', 'opencode', 'codebuddy', 'hermes', 'pi', 'openclaw'];

  it('maps every built-in Agent id to copy that exists in both locales', () => {
    for (const agentId of agentIds) {
      const copy = agentCopyKeys(agentId);
      expect(copy, agentId).toBeDefined();
      for (const dictionary of [en, zh]) {
        const desc = resolveKey(dictionary, copy!.desc);
        expect(desc, `${agentId} desc`).toBeTruthy();
        // A hit that returns the key itself is the failure this table exists to prevent.
        expect(desc).not.toContain('blueprint.agent');
        if (copy!.install) {
          const install = resolveKey(dictionary, copy!.install);
          expect(install, `${agentId} install`).toBeTruthy();
          expect(install).toMatch(/install|pip|npm/i);
        }
      }
    }
  });

  it('answers undefined for an unknown id so the caller renders nothing instead of a raw key', () => {
    expect(agentCopyKeys('some-user-registered-cli')).toBeUndefined();
  });

  it('does not resolve inherited object properties as copy keys', () => {
    // A custom Agent's id is its launch command, which is user input.
    expect(agentCopyKeys('constructor')).toBeUndefined();
    expect(agentCopyKeys('toString')).toBeUndefined();
  });
});
