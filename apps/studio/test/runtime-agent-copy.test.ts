import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/locales/en';
import type { KeyPath } from '../src/i18n/i18n';
import { dictionaries, resolveKey } from './key-resolution';

// The runtime panel and the gates that open it talk about one specific run, and who runs it is data:
// RuntimeRun.agentId, picked from a catalog that has four verified Agents. Naming an Agent in this copy
// is therefore not a translation gap but a false statement about the run — the panel used to say
// "Run Codex" for a Hermes run, and the confirmation in front of the write gate said the same.

const AGENT_NAMES = /codex|opencode|codebuddy|claude|hermes|openclaw|aider/gi;

function leafKeys(node: unknown, path: string[]): string[] {
  if (typeof node === 'string') return [path.join('.')];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => leafKeys(value, [...path, key]));
}

// Every string the run surface can show, collected from the table rather than listed by hand, so a
// newly added one is covered without anyone remembering to extend this test.
const RUN_COPY = [...leafKeys(en.runtime, ['runtime']), ...leafKeys(en.confirmations, ['confirmations'])];

// Copy that points at the executor has to receive it, so the sentence cannot drift back to a name.
// Typed as KeyPath[]: renaming one of these keys in the locale table breaks compilation here rather
// than leaving the check pointed at nothing.
const EXECUTOR_COPY: KeyPath[] = [
  'runtime.completed', 'runtime.failed', 'runtime.running', 'runtime.planned',
  'runtime.runAgent', 'runtime.runningAgent', 'runtime.retryAgent', 'runtime.retryingAgent',
  'runtime.executionFailed', 'runtime.retryFailed',
  'confirmations.startAgent', 'confirmations.retryAgent',
];

describe('runtime copy names the executor as data', () => {
  it('walks both blocks instead of nothing', () => {
    expect(RUN_COPY).toContain('runtime.runAgent');
    expect(RUN_COPY).toContain('confirmations.startAgent');
    expect(RUN_COPY.length).toBeGreaterThan(20);
  });

  it('never names an installed Agent in the run surface', () => {
    for (const key of RUN_COPY) {
      for (const [dictionary, locale] of dictionaries) {
        const wording = resolveKey(dictionary, key as KeyPath);
        expect(wording, `${locale} / ${key}`).toBeTruthy();
        expect(wording?.match(AGENT_NAMES) ?? [], `${locale} / ${key} names an Agent instead of taking {agent}`).toEqual([]);
      }
    }
  });

  it('takes the executor as a parameter in every string that mentions it', () => {
    for (const key of EXECUTOR_COPY) {
      for (const [dictionary, locale] of dictionaries) {
        expect(resolveKey(dictionary, key), `${locale} / ${key} must interpolate {agent}`).toContain('{agent}');
      }
    }
  });
});
