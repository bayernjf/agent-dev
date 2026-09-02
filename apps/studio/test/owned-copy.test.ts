import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Why this exists: every string the interface owns has to reach the user through t(), because a
// literal left in JSX is unreadable for half the audience and invisible to `zh satisfies
// Translations`. That gap turned up five separate times while walking the UI by hand — the header,
// the pipeline editor, the diff panel, the runtime list, the failure display. This walks it instead.
//
// Deliberately an over-approximation of "user-visible copy", so the exclusions are part of the
// contract and are listed per shape. It cannot see copy assembled at render time, and it does not
// judge text that arrives from a backend package — that boundary is still open elsewhere.

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    // The locale tables are the translations themselves; English and Chinese literals are their job.
    else if (/\.tsx$/.test(entry.name) && !full.includes(join('i18n', 'locales'))) found.push(full);
  }
  return found;
}

// Names that stay as written in both locales. Matched case-insensitively so this list cannot drift
// into being a second place where copy gets decided.
const PROPER_NOUNS = /^(supabase|vercel|cloudflare|github|codex|opencode|codebuddy|hermes|openclaw|aider|claude|tauri|electron|expo|hono|vite|react|node|npm|npx|git|json|sql|api|url|ui|cli|pr|diff|dry[- ]?run|wsl|win32|android|ios|windows|macos|linux|docker|postgres|jwt|oauth|mcp|sse|https?)$/i;

const isLabelOnly = (text: string) =>
  text.split(/[\s,./>-]+/).filter(Boolean).every(word => PROPER_NOUNS.test(word));

// The two literal shapes that are not copy: a locale key path, and a glyph or short token with no
// letters to translate.
const isKeyPath = (text: string) => /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(text);
const isCopy = (text: string) => text.trim().length > 1 && /[A-Za-z]{2}/.test(text) && !isKeyPath(text) && !isLabelOnly(text);

// Ternary branches are the noisiest shape: most of them pick a CSS modifier or an enum value, not a
// label ('connected' : 'missing', 'verified' : 'unverified'). A branch counts as copy only when it
// is written the way this product's labels are written — capitalized words, or more than one word.
const looksLikeProse = (text: string) => /[A-Z][a-z]/.test(text) || (text.includes(' ') && /[A-Za-z]{2}/.test(text));

type Finding = { where: string; why: string };

function scan(relative: string, text: string): Finding[] {
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  const findings: Finding[] = [];
  const push = (index: number, why: string) => findings.push({ where: `${relative}:${lineOf(index)}`, why });

  // 1. Attributes that are shown as tooltips or read aloud. A literal here is always a miss.
  for (const m of text.matchAll(/\b(?:title|aria-label|placeholder|alt|summary)\s*=\s*"([^"]+)"/g)) {
    if (m[1].trim()) push(m.index ?? 0, `attribute text "${m[1]}"`);
  }

  // 2. JSX text children — word-shaped tokens between `>` and `<`.
  for (const m of text.matchAll(/>((?:[A-Za-z][A-Za-z&,.'!?\-/:()]{1,40} ){1,12}[A-Za-z][A-Za-z&,.!?'\-/:()]{1,40})</g)) {
    if (isCopy(m[1])) push(m.index ?? 0, `JSX text "${m[1]}"`);
  }

  // 3. A ternary picking between two strings, the shape most of this UI's labels take
  // ({editing ? 'Cancel' : 'Edit Pipeline'}). Branches that are key paths are the correct form and
  // are skipped; everything else that reads like prose was never moved out.
  for (const m of text.matchAll(/\?\s*'([^']{2,80})'\s*:\s*'([^']{2,80})'/g)) {
    for (const branch of [m[1], m[2]]) {
      if (isCopy(branch) && looksLikeProse(branch)) push(m.index ?? 0, `ternary branch "${branch}"`);
    }
  }

  return findings;
}

describe('studio copy goes through the locale tables', () => {
  it('scans the component tree rather than nothing', () => {
    const files = sourceFiles(SRC);
    expect(files.some(f => f.endsWith('App.tsx'))).toBe(true);
    expect(files.some(f => f.endsWith('FailureDisplay.tsx'))).toBe(true);
  });

  it('catches each shape it claims to catch', () => {
    const fixture = [
      '<button title="Export this">x</button>',
      '<p>No diff available.</p>',
      '{editing ? \'Cancel\' : \'Edit Pipeline\'}',
    ].join('\n');
    expect(scan('fixture.tsx', fixture).map(f => f.why)).toEqual([
      'attribute text "Export this"',
      'JSX text "No diff available."',
      'ternary branch "Cancel"',
      'ternary branch "Edit Pipeline"',
    ]);
  });

  it('leaves key paths, glyphs, product names and state tokens alone', () => {
    const fixture = [
      "{saving ? t('runtime.preparing') : t('runtime.prepare')}",
      '{ok ? \'\u2713\' : \'\u2013\'}',
      '<span>Codex CLI</span>',
      "{state === 'ok' ? 'connected' : 'missing'}",
      "{isPut ? 'PUT' : 'POST'}",
    ].join('\n');
    expect(scan('fixture.tsx', fixture)).toEqual([]);
  });

  it('finds no string the interface owns left as a literal in JSX', () => {
    const findings = sourceFiles(SRC)
      .flatMap(file => scan(file.slice(SRC.length + 1).replace(/\\/g, '/'), readFileSync(file, 'utf8')))
      .map(f => `${f.where}  ${f.why}`);
    expect(
      findings,
      'move the text into apps/studio/src/i18n/locales/en.ts and zh.ts and render it with t()',
    ).toEqual([]);
  });
});
