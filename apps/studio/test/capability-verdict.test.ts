import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/locales/en';
import { nonInteractiveVerdict } from '../src/lib/capability-verdict';
import { zh } from '../src/i18n/locales/zh';
import type { AgentCapabilityProbe } from '../src/types';

// Why this exists: the probe reads a CLI's help output and never runs the CLI, but the row rendered
// whatever came out as a promise or its absence - `non-interactive: yes` for documentation,
// `non-interactive: unknown` for both "we looked and it is not there" and "this Agent's
// non-interactive path is not something help text can show". Three readings, three wordings.

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Source evidence has one rule here: read the file with whole-line comments removed, so that
// commenting a wiring row out is a failing change rather than a passing one.
const code = (file: string) => readFileSync(`${SRC}/${file}`, 'utf8')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');

const probe = (over: Partial<AgentCapabilityProbe> = {}): AgentCapabilityProbe => ({
  agentId: 'codex',
  nonInteractive: false,
  nonInteractiveFlags: ['--json'],
  helpAvailable: true,
  adapterStatus: 'verified',
  ...over,
});

const readings = ['listed', 'absent', 'inconclusive'] as const;

describe('the capability probe row keeps its three answers apart', () => {
  it('calls a switch that was looked for and not found absent, not unknown', () => {
    // The old wording claimed nobody had looked. The probe had looked, at the right help level.
    expect(nonInteractiveVerdict(probe())).toBe('absent');
  });

  it('does not turn a silent CLI into a contradiction', () => {
    // A help page that timed out or printed nothing says nothing about the Agent.
    expect(nonInteractiveVerdict(probe({ helpAvailable: false }))).toBe('inconclusive');
  });

  it('does not turn a non-question into a contradiction', () => {
    // OpenCode 2.0 is driven through a local API by a script; measured on a machine that has it
    // installed, its `--help` does not even contain the word `api`. Nothing was ever going to be
    // looked for, so neither "listed" nor "not listed" is available.
    expect(nonInteractiveVerdict(probe({ nonInteractiveFlags: [] }))).toBe('inconclusive');
  });

  it('reads a documented switch as documented', () => {
    expect(nonInteractiveVerdict(probe({ nonInteractive: true }))).toBe('listed');
  });

  it('renders the reading rather than the raw boolean', () => {
    const app = code('App.tsx');
    expect(app).toContain("t(`agents.nonInteractiveVerdict.${nonInteractiveVerdict(probe)}` as KeyPath)");
    expect(app).not.toContain('agents.nonInteractiveYes');
    expect(app).not.toContain('agents.nonInteractiveUnknown');
  });

  it('prints no capability the probe never observed', () => {
    // `workspaceWrite` was copied out of the catalog's static declaration by a function named
    // probe, in the row directly below the chips that print that same declaration.
    const app = code('App.tsx');
    expect(app).not.toContain('workspaceWrite');
    for (const dictionary of [en, zh]) {
      expect(Object.keys(dictionary.agents).filter(key => key.startsWith('workspaceWrite'))).toEqual([]);
    }
  });

  // The point of the rewrite is that the chip names its own source, so the wordings are pinned to it:
  // a reading that stops saying where its evidence came from is the flat verdict this replaced.
  it('names the evidence behind every reading, in both locales', () => {
    for (const reading of readings) {
      expect(en.agents.nonInteractiveVerdict[reading]).toMatch(/help/);
      expect(zh.agents.nonInteractiveVerdict[reading]).toMatch(/帮助/);
    }
    expect(new Set(readings.map(reading => en.agents.nonInteractiveVerdict[reading])).size).toBe(3);
  });
});
