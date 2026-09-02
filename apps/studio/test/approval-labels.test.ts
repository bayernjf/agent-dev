import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import type { KeyPath } from '../src/i18n/i18n';
import { dictionaries, resolveKey } from './key-resolution';

// Two labels that English keeps apart can still collapse into one word when translated, and at an
// approval gate the difference is the whole message: "your turn" is the opposite of "waiting on
// someone else". Chinese had both readings as 等待批准. Group the labels by the state they name and
// assert the grouping survives in every locale — same meaning stays one wording, different
// meanings never share one.
const APPROVAL_GATES: { meaning: string; keys: KeyPath[] }[] = [
  { meaning: 'ready for the user to approve', keys: ['decisions.readyForApproval', 'baseline.status.ready'] },
  { meaning: 'approval requested and pending', keys: ['projectState.AWAITING_APPROVAL', 'baseline.resourceStatus.awaiting'] },
];

describe('approval gate labels', () => {
  it('gives one state one wording in every locale', () => {
    for (const gate of APPROVAL_GATES) {
      for (const [dictionary, locale] of dictionaries) {
        const labels = gate.keys.map(key => resolveKey(dictionary, key));
        for (const label of labels) expect(label, `${locale} / ${gate.meaning}`).toBeTruthy();
        expect(new Set(labels).size, `${locale} / ${gate.meaning}`).toBe(1);
      }
    }
  });

  it('does not merge two different gates into the same wording', () => {
    for (const dictionary of [en, zh]) {
      const wordings = APPROVAL_GATES.map(gate => resolveKey(dictionary, gate.keys[0])!);
      expect(new Set(wordings).size, wordings.join(' / ')).toBe(APPROVAL_GATES.length);
    }
  });
});
