import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import type { KeyPath } from '../src/i18n/i18n';

export type Dictionary = typeof en | typeof zh;
export const dictionaries: [Dictionary, string][] = [[en, 'en'], [zh, 'zh']];

// `t()` answers a miss by handing back the key, which is how a mistranslated lookup ended up on
// screen as literal text. `zh satisfies Translations` cannot catch a path built at call time, so
// walk the segments here and prove the string exists in the locale the UI will actually read.
export function resolveKey(dictionary: Dictionary, path: KeyPath): string | undefined {
  let current: unknown = dictionary;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}
