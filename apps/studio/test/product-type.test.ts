import { describe, expect, it } from 'vitest';
import { PRODUCT_TYPE_LABEL_KEYS, productTypeLabelKey } from '../src/lib/product-type';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import { resolveKey } from './key-resolution';

describe('product type label table', () => {
  it('covers every product type the answers type allows', () => {
    // Six product types are supported; a table that silently drops one sends the dashboard back to
    // printing `browser-extension` in a Chinese UI.
    expect(PRODUCT_TYPE_LABEL_KEYS.map(([value]) => value)).toEqual([
      'web-app', 'landing-page', 'browser-extension', 'desktop', 'mobile', 'api-tool',
    ]);
  });

  it('resolves to real copy in both locales', () => {
    for (const [value, labelKey] of PRODUCT_TYPE_LABEL_KEYS) {
      for (const dictionary of [en, zh]) {
        const label = resolveKey(dictionary, labelKey);
        expect(label, `${value} / ${labelKey}`).toBeTruthy();
        // The point of the table is that the user never sees the stored identifier.
        expect(label).not.toContain(value);
      }
    }
  });

  it('answers undefined for a product type this build does not know', () => {
    expect(productTypeLabelKey('quantum-terminal')).toBeUndefined();
    expect(productTypeLabelKey('constructor')).toBeUndefined();
  });
});
