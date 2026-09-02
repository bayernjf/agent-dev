import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/i18n';
import { useDomainText } from '../src/lib/domain-text';
import { dictionaries, resolveKey } from './key-resolution';

// useDomainText resolves a backend-emitted prose field through the locale table when a stable key is
// present, and falls back to the English prose when the key is missing from both locales. This is the
// safety net that lets us migrate domain prose incrementally: any unkeyed or untranslated field still
// shows its English text, never a raw i18n key.
function Probe({ text, i18nKey, params }: { text: string; i18nKey?: string; params?: Record<string, string | number> }) {
  const domainT = useDomainText();
  return <span>{domainT(text, i18nKey, params)}</span>;
}

function render(text: string, i18nKey?: string, params?: Record<string, string | number>) {
  return renderToString(
    <I18nProvider>
      <Probe text={text} i18nKey={i18nKey} params={params} />
    </I18nProvider>,
  );
}

describe('useDomainText', () => {
  it('resolves a present key through the locale table', () => {
    const html = render('English fallback', 'dryRun.automaticPreparation.validateSchema');
    expect(html).toContain('Validate the ProductBlueprint schema');
    expect(html).not.toContain('English fallback');
  });

  it('interpolates params into the resolved translation', () => {
    const html = render('English fallback', 'dryRun.summary', { artifactCount: 12, actionCount: 4 });
    expect(html).toContain('12 generated artifacts');
    expect(html).toContain('4 manual actions');
  });

  it('falls back to the English prose when the key is absent from both locales', () => {
    const html = render('Keep this English text', 'dryRun.this.key.does.not.exist');
    expect(html).toContain('Keep this English text');
    expect(html).not.toContain('dryRun.this.key.does.not.exist');
  });

  it('returns the prose unchanged when no key is supplied (un-migrated fields)', () => {
    const html = render('Plain English prose with no key');
    expect(html).toContain('Plain English prose with no key');
  });
});

// Every dry-run key the backend emits must resolve in both en and zh, so a Chinese user never sees
// English in the dry-run section once this batch is merged.
describe('dry-run locale key coverage', () => {
  const keys = [
    'dryRun.summary',
    'dryRun.automaticPreparation.validateSchema',
    'dryRun.automaticPreparation.generateArtifacts',
    'dryRun.automaticPreparation.classifyBoundaries',
  ] as const;

  for (const key of keys) {
    it(`resolves ${key} in both locales`, () => {
      for (const [dict, name] of dictionaries) {
        const value = resolveKey(dict, key);
        expect(value, `${name} missing ${key}`).toBeDefined();
        expect(value!.length).toBeGreaterThan(0);
      }
    });
  }

  it('summary declares both interpolation params', () => {
    for (const [dict] of dictionaries) {
      const value = resolveKey(dict, 'dryRun.summary')!;
      expect(value).toContain('{artifactCount}');
      expect(value).toContain('{actionCount}');
    }
  });
});
