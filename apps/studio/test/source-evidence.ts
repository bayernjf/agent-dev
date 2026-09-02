import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Why this exists: four Studio test files read this package's own source as evidence, and three of
// them had grown a byte-identical copy of the same rule while the fourth never got it. A rule that
// lives in four places drifts - that is the exact shape of the defect this suite was written to stop
// (two switch tables in two files, disagreeing about which flag Codex takes). One module, one rule.
//
// The rule: whole-line `//` comments are removed before an assertion looks for a call site, because
// "this key is rendered" and "this row is wired" are claims about code that runs. A commented-out
// line still contains the text, so an evidence assertion reading the raw file passes while the
// behaviour it names is gone.
//
// Deliberately narrow, and the narrowness is part of the contract: only whole-line `//` comments go.
// A trailing comment after code, and anything inside a `/* */` or JSX `{/* */}` block, still counts as
// evidence. Closing those needs a real parser, and claiming to have closed them without one is the
// same overclaim this rule exists to prevent.
export const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function withoutLineComments(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * One source file as positive evidence - use this whenever the assertion is "this call site exists".
 * `file` is a path under src/, forward slashes, as in `readSource('App.tsx')`.
 */
export function readSource(file: string): string {
  return withoutLineComments(readFileSync(`${SRC}/${file}`, 'utf8'));
}

function relativeToSrc(file: string): string {
  return file.slice(SRC.length + 1).replace(/\\/g, '/');
}

function walk(directory: string, extensions: RegExp, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    // The locale tables are the translations themselves; English and Chinese literals are their job,
    // and a key defined there is not evidence that anything renders it.
    if (full.includes(join('i18n', 'locales'))) continue;
    if (entry.isDirectory()) walk(full, extensions, found);
    else if (extensions.test(entry.name)) found.push(full);
  }
  return found;
}

/** One walked source file: the name a finding should print, and its text verbatim. */
export type WalkedSource = { relative: string; text: string };

/**
 * Every `.tsx` component under src/, locale tables excluded - the tree a copy scan walks. Two rules
 * are deliberate here:
 *
 * Paths stay inside this module. Handing callers absolute paths and then asking them to read through
 * a helper that re-joins `SRC` doubles a path, and only at runtime - which is what the first version
 * of this module did.
 *
 * The text comes back verbatim, comments and all. A copy scan asserts that *nothing* is left
 * untranslated, so a comment can only add a finding, never hide one; the loophole `readSource` closes
 * does not exist in that direction. Stripping here would instead let a literal be silenced by
 * commenting its line out rather than translating it, and dead copy is not a passing state.
 */
export function componentSources(): WalkedSource[] {
  return walk(SRC, /\.tsx$/).map(file => ({
    relative: relativeToSrc(file),
    text: readFileSync(file, 'utf8'),
  }));
}

/**
 * Every `.ts` and `.tsx` under src/ as one comment-stripped blob - evidence that a key is rendered
 * *somewhere*, which is a weaker claim than a named call site and is only honest once comments are
 * out of it.
 */
export function renderedSourceBlob(): string {
  return walk(SRC, /\.(ts|tsx)$/).map(file => withoutLineComments(readFileSync(file, 'utf8'))).join('\n');
}
