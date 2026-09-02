import { baselineProvidersFor, type BaselineProviderId, type BlueprintAnswers } from '@agent-dev/blueprint';
import type { KeyPath } from '../i18n/i18n';

// Provider names are proper nouns and read the same in both locales, so only the list is composed
// here. The sentence around it stays in the locale tables, where `zh satisfies Translations` and the
// key-resolution tests can see it.
const CLOUD_PROVIDER_LABELS = {
  supabase: 'Supabase',
  vercel: 'Vercel Functions',
  cloudflare: 'Cloudflare Pages',
} as const satisfies Record<Exclude<BaselineProviderId, 'github'>, string>;

type CloudProviderId = keyof typeof CLOUD_PROVIDER_LABELS;

export type BaselineNote = { key: KeyPath; params?: Record<string, string> };

// This note renders directly under the product type picker, so it has to describe the type actually
// selected. Four of the six provision nothing outside GitHub, and the single sentence that used to
// be here told all of them their baseline uses Supabase, Cloudflare Pages and Vercel Functions — the
// same false claim the backend decision cards made, on the screen where the user picks the type.
export function baselineNoteFor(productType: BlueprintAnswers['productType']): BaselineNote {
  const cloudProviders = baselineProvidersFor(productType).filter(
    (provider): provider is CloudProviderId => provider !== 'github',
  );
  return cloudProviders.length === 0
    ? { key: 'blueprint.baselineNoteRepositoryOnly' }
    : {
      key: 'blueprint.baselineNoteCloud',
      params: { providers: cloudProviders.map(provider => CLOUD_PROVIDER_LABELS[provider]).join(', ') },
    };
}
