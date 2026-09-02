import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import type { KeyPath } from '../src/i18n/i18n';
import { dictionaries, resolveKey } from './key-resolution';

// A label that stays in Latin in the Chinese table has not been translated — it is carried over as
// written. Carrying it over in a different capitalisation than the English table uses is a second,
// unreviewed decision about the same two words, and it shows up on screen as two products side by
// side: the Runtime panel said `Agent Runtime` in Chinese and `Agent runtime` in English.
//
// So the rule is narrow and mechanical: when neither locale writes CJK for a key, the two strings
// have to be the same string. The moment one side translates, the comparison is meaningless and is
// skipped, which keeps this from becoming a style judge over the whole table.
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

function leafKeys(node: unknown, path: string[]): KeyPath[] {
  if (typeof node === 'string') return [path.join('.') as KeyPath];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => leafKeys(value, [...path, key]));
}

const ALL_KEYS = leafKeys(en, []);

function untranslatedDivergences(): string[] {
  const divergences: string[] = [];
  for (const key of ALL_KEYS) {
    const english = resolveKey(en, key);
    const chinese = resolveKey(zh, key);
    if (english === undefined || chinese === undefined) continue;
    if (CJK.test(english) || CJK.test(chinese)) continue;
    if (english !== chinese) divergences.push(`${key}: en "${english}" / zh "${chinese}"`);
  }
  return divergences;
}

describe('a label both locales leave in Latin is written the same way in both', () => {
  it('walks the whole table instead of nothing', () => {
    expect(ALL_KEYS.length).toBeGreaterThan(400);
    // Two keys are known to be carried over untranslated, so the check below has something to see.
    expect(ALL_KEYS).toContain('runtime.eyebrow');
    expect(ALL_KEYS).toContain('agents.eyebrow');
  });

  it('finds no key whose untranslated text differs between the locales', () => {
    expect(
      untranslatedDivergences(),
      'align the capitalisation or the wording in apps/studio/src/i18n/locales/zh.ts with en.ts',
    ).toEqual([]);
  });

  it('accepts the two carried-over eyebrows as identical in both locales', () => {
    for (const key of ['runtime.eyebrow', 'agents.eyebrow'] as KeyPath[]) {
      const [english, chinese] = dictionaries.map(([dictionary]) => resolveKey(dictionary, key));
      expect(chinese, `${key} is untranslated in zh, so it must match en exactly`).toBe(english);
    }
  });

  it('does not police a key that zh actually translates', () => {
    // plan.eyebrow is the counter-example: zh keeps the Latin term `Dry Run` but translates the
    // rest, so the rule has to stand down rather than force one language back into the other.
    expect(CJK.test(resolveKey(zh, 'plan.eyebrow') ?? '')).toBe(true);
    expect(untranslatedDivergences().some(entry => entry.includes('plan.eyebrow'))).toBe(false);
  });
});
