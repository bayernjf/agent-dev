import { describe, expect, it } from 'vitest';
import { baselineProvidersFor, productTypeSchema } from '@agent-dev/blueprint';
import { baselineNoteFor } from '../src/lib/baseline-note';
import { dictionaries, resolveKey } from './key-resolution';
import { readSource } from './source-evidence';

const EXPECTED: Record<(typeof productTypeSchema.options)[number], string | null> = {
  'web-app': 'Supabase, Vercel Functions, Cloudflare Pages',
  'landing-page': 'Cloudflare Pages',
  // Four of the six types create nothing outside their GitHub repository, so they get the note that
  // says so instead of a provider list. `null` means "the repository-only key".
  'browser-extension': null,
  desktop: null,
  mobile: null,
  'api-tool': null,
};

function placeholders(copy: string): string[] {
  return [...copy.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
}

describe('baseline note', () => {
  it('names only the cloud providers the selected product type provisions', () => {
    for (const productType of productTypeSchema.options) {
      const note = baselineNoteFor(productType);
      const expected = EXPECTED[productType];
      if (expected === null) {
        expect(note, productType).toEqual({ key: 'blueprint.baselineNoteRepositoryOnly' });
        // GitHub is a baseline provider for every type but is not a cloud account, and this note sits
        // under a picker where four types have no cloud account at all. Naming it would resurrect the
        // exact claim this note replaced.
        expect(baselineProvidersFor(productType)).toEqual(['github']);
        continue;
      }
      expect(note, productType).toEqual({
        key: 'blueprint.baselineNoteCloud',
        params: { providers: expected },
      });
      // The list is derived from the same table that writes generated/PRODUCT_STANDARD.md, so the two
      // can only disagree if one of them stops reading it.
      const clouds = baselineProvidersFor(productType).filter(provider => provider !== 'github');
      expect(expected.split(', ')).toHaveLength(clouds.length);
    }
  });

  it('resolves to real copy in both locales, with matching placeholders', () => {
    for (const productType of productTypeSchema.options) {
      const note = baselineNoteFor(productType);
      for (const [dictionary, locale] of dictionaries) {
        const copy = resolveKey(dictionary, note.key);
        expect(copy, `${locale} / ${note.key}`).toBeTruthy();
        // `t()` leaves an unknown placeholder in the string verbatim, so a locale that gained or lost
        // `{providers}` would print `{providers}` to the user rather than fail anywhere else.
        expect(placeholders(copy ?? ''), `${locale} / ${note.key}`).toEqual(Object.keys(note.params ?? {}));
      }
    }
  });

  it('keeps the two notes apart in what they promise', () => {
    // Only one of the two may mention a cloud account, and only the other may say nothing is created.
    // Swapping the keys is otherwise invisible: both are grammatical sentences.
    for (const [dictionary, locale] of dictionaries) {
      const cloud = dictionary.blueprint.baselineNoteCloud;
      const repositoryOnly = dictionary.blueprint.baselineNoteRepositoryOnly;
      expect(cloud.includes('{providers}'), locale).toBe(true);
      expect(repositoryOnly.includes('{providers}'), locale).toBe(false);
      expect(repositoryOnly.includes('GitHub'), locale).toBe(true);
    }
  });

  // Everything above holds even if the note is wired to something else — a constant, or the type of
  // the *selected project* rather than the answer being edited. This repo has no DOM test
  // environment, so the wiring is pinned the way the rest of the suite pins it: read the call site
  // with whole-line comments stripped. What is not covered is the switch itself, which needs a
  // browser: changing the picker has to change the sentence on screen.
  it('follows the answer being edited, at the call site', () => {
    const app = readSource('App.tsx');
    expect(app).toContain('baselineNoteFor(answers.productType)');
    expect(app).toContain('t(baselineNote.key, baselineNote.params)');
  });
});
