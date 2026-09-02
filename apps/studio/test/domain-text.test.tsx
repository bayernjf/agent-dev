import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { I18nProvider, type KeyPath } from '../src/i18n/i18n';
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

// Every decision key the backend emits must resolve in both locales, so a Chinese user never sees
// English in the decision cards once this batch is merged.
describe('decision locale key coverage', () => {
  const keys = [
    'decision.stack.title', 'decision.stack.reason',
    'decision.sourceControl.title', 'decision.sourceControl.value', 'decision.sourceControl.reason',
    'decision.providers.title', 'decision.providers.reason.none', 'decision.providers.reason.hasProviders',
    'decision.production.title', 'decision.production.value', 'decision.production.reason',
    'decision.privacy.title', 'decision.privacy.value.sensitive', 'decision.privacy.value.standard',
    'decision.privacy.reason.sensitive', 'decision.privacy.reason.standard',
    'decision.preview.title', 'decision.preview.value.per-pull-request', 'decision.preview.value.stable-dev-api',
    'decision.preview.reason.perPullRequest', 'decision.preview.reason.stableDevApi',
    'decision.analytics.title', 'decision.analytics.value.none', 'decision.analytics.value.hasProviders',
    'decision.analytics.reason.none', 'decision.analytics.reason.hasProviders',
    'decision.runtime.title', 'decision.runtime.reason.beginner', 'decision.runtime.reason.professional',
    'decision.custom.title', 'decision.custom.reason',
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
});

describe('manualAction locale key coverage', () => {
  const actionNames = ['github', 'supabase', 'cloudflare', 'vercel', 'privacyReview', 'analytics', 'custom'] as const;
  const fields = ['title', 'reason', 'steps.0', 'steps.1', 'steps.2', 'verification'] as const;
  const keys = actionNames.flatMap(name => fields.map(f => `manualAction.${name}.${f}` as KeyPath));

  for (const key of keys) {
    it(`resolves ${key} in both locales`, () => {
      for (const [dict, name] of dictionaries) {
        const value = resolveKey(dict, key);
        expect(value, `${name} missing ${key}`).toBeDefined();
        expect(value!.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('artifact locale key coverage', () => {
  const keys = [
    'artifact.agent-instructions',
    'artifact.delivery-handoff',
    'artifact.delivery-workflow',
    'artifact.desktop-build-rs',
    'artifact.desktop-cargo-toml',
    'artifact.desktop-gitignore',
    'artifact.desktop-icon-script',
    'artifact.desktop-index-html',
    'artifact.desktop-lib-rs',
    'artifact.desktop-main-rs',
    'artifact.desktop-main-ts',
    'artifact.desktop-package',
    'artifact.desktop-quality-workflow',
    'artifact.desktop-readme',
    'artifact.desktop-styles',
    'artifact.desktop-tauri-conf',
    'artifact.desktop-tsconfig',
    'artifact.desktop-vite-config',
    'artifact.distribution-guide',
    'artifact.environment-contract',
    'artifact.ext-background-ts',
    'artifact.ext-content-ts',
    'artifact.ext-gitignore',
    'artifact.ext-manifest-config',
    'artifact.ext-options-html',
    'artifact.ext-options-ts',
    'artifact.ext-package',
    'artifact.ext-popup-css',
    'artifact.ext-popup-html',
    'artifact.ext-popup-ts',
    'artifact.ext-quality-workflow',
    'artifact.ext-readme',
    'artifact.ext-tsconfig',
    'artifact.ext-vite-config',
    'artifact.mcp-entry',
    'artifact.mcp-eslint-config',
    'artifact.mcp-gitignore',
    'artifact.mcp-package',
    'artifact.mcp-quality-workflow',
    'artifact.mcp-readme',
    'artifact.mcp-server',
    'artifact.mcp-test',
    'artifact.mcp-tsconfig',
    'artifact.mcp-tsconfig-build',
    'artifact.mcp-vitest-config',
    'artifact.mobile-app-json',
    'artifact.mobile-babel-config',
    'artifact.mobile-eas-json',
    'artifact.mobile-gitignore',
    'artifact.mobile-home-screen',
    'artifact.mobile-layout',
    'artifact.mobile-package',
    'artifact.mobile-quality-workflow',
    'artifact.mobile-readme',
    'artifact.mobile-tsconfig',
    'artifact.product-standard',
    'artifact.template-api-index',
    'artifact.template-api-package',
    'artifact.template-api-test',
    'artifact.template-api-vercel',
    'artifact.template-app-js',
    'artifact.template-build-script',
    'artifact.template-cloudflare',
    'artifact.template-eslint-config',
    'artifact.template-forms-gitignore',
    'artifact.template-gitignore',
    'artifact.template-index',
    'artifact.template-quality-workflow',
    'artifact.template-readme.landing-page',
    'artifact.template-readme.web-app',
    'artifact.template-root-package.landing-page',
    'artifact.template-root-package.web-app',
    'artifact.template-root-tsconfig',
    'artifact.template-smoke-script',
    'artifact.template-styles',
    'artifact.template-vite-config',
    'artifact.template-web-index',
    'artifact.template-web-main',
    'artifact.template-web-package',
    'artifact.template-web-styles',
  ] as const;

  for (const key of keys) {
    it(`resolves ${key} in both locales`, () => {
      for (const [dict, name] of dictionaries) {
        const value = resolveKey(dict, key as KeyPath);
        expect(value, `${name} missing ${key}`).toBeDefined();
        expect(value!.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('baseline locale key coverage', () => {
  const keys = [
    'baseline.summary.ready', 'baseline.summary.blocked',
    'baseline.resource.github.title', 'baseline.resource.github.missingReason',
    'baseline.resource.supabase.title', 'baseline.resource.supabase.missingReason',
    'baseline.resource.vercel.title', 'baseline.resource.vercel.missingReason',
    'baseline.resource.cloudflare.title', 'baseline.resource.cloudflare.missingReason',
    'baseline.resource.reason.hasOwner',
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
});
