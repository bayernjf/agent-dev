import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
//
// renderedBy is not decoration. A wording test on a string no component renders protects copy nobody
// can see, and it quietly implies the user-facing bug is fixed when it is not; one key listed here
// originally was defined but never rendered. Each entry therefore has to name the code path that puts
// it on screen — a literal t() call, or the interpolation that builds the key at render time.
type GateLabel = { key: KeyPath; renderedBy: string };

const APPROVAL_GATES: { meaning: string; labels: GateLabel[] }[] = [
  {
    meaning: 'the gate is open and the user is the one who has to act',
    labels: [{ key: 'baseline.status.ready', renderedBy: "t('baseline.status.ready')" }],
  },
  {
    meaning: 'approval was requested and somebody else still has to act',
    labels: [
      { key: 'projectState.AWAITING_APPROVAL', renderedBy: 'projectState.${' },
      { key: 'baseline.resourceStatus.awaiting', renderedBy: "t('baseline.resourceStatus.awaiting')" },
    ],
  },
];

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceBlob(dir: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Defining a key is not the same as rendering it.
      if (full.includes(join('i18n', 'locales'))) continue;
      parts.push(sourceBlob(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      parts.push(readFileSync(full, 'utf8'));
    }
  }
  return parts.join('\n');
}

const RENDERED = sourceBlob(SRC);
const ALL_LABELS = APPROVAL_GATES.flatMap(gate => gate.labels);

describe('approval gate labels', () => {
  it('pins only wordings a component actually renders', () => {
    for (const label of ALL_LABELS) {
      expect(RENDERED, `${label.key} is not rendered; delete the key or point at the code that shows it`)
        .toContain(label.renderedBy);
    }
  });

  it('gives one state one wording in every locale', () => {
    for (const gate of APPROVAL_GATES) {
      for (const [dictionary, locale] of dictionaries) {
        const wordings = gate.labels.map(label => resolveKey(dictionary, label.key));
        for (const wording of wordings) expect(wording, `${locale} / ${gate.meaning}`).toBeTruthy();
        expect(new Set(wordings).size, `${locale} / ${gate.meaning}`).toBe(1);
      }
    }
  });

  it('does not merge two different gates into the same wording', () => {
    for (const dictionary of [en, zh]) {
      const wordings = APPROVAL_GATES.map(gate => resolveKey(dictionary, gate.labels[0].key)!);
      expect(new Set(wordings).size, wordings.join(' / ')).toBe(APPROVAL_GATES.length);
    }
  });
});
