import { describe, expect, it } from 'vitest';
import { agentCopyKeys } from '../src/lib/agent-copy';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import type { KeyPath } from '../src/i18n/i18n';

type Dictionary = typeof en | typeof zh;

// `t()` answers a miss by handing back the key, which is how a mistranslated lookup ended up on
// screen as the literal text "blueprint.agentClaudecodeDesc". The table has to be the thing that
// cannot miss, in every locale, so walk the paths here instead of trusting the compiler to see a
// string built at call time.
function resolve(dictionary: Dictionary, path: KeyPath): string | undefined {
  let current: unknown = dictionary;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

describe('agent copy key table', () => {
  const agentIds = ['codex', 'claude-code', 'aider', 'opencode', 'codebuddy', 'hermes', 'pi', 'openclaw'];

  it('maps every built-in Agent id to copy that exists in both locales', () => {
    for (const agentId of agentIds) {
      const copy = agentCopyKeys(agentId);
      expect(copy, agentId).toBeDefined();
      for (const dictionary of [en, zh]) {
        const desc = resolve(dictionary, copy!.desc);
        expect(desc, `${agentId} desc`).toBeTruthy();
        // A hit that returns the key itself is the failure this table exists to prevent.
        expect(desc).not.toContain('blueprint.agent');
        if (copy!.install) {
          const install = resolve(dictionary, copy!.install);
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
