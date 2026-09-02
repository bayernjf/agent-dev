import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as selectability from '../src/lib/agent-selectability';
import {
  adapterStatusOf, canProfileRunTasks, canRunSelectedAgent, canRunTasks,
} from '../src/lib/agent-selectability';
import type { AgentDescriptor, AgentProfile } from '../src/types';

// Why this exists: "detected" and "can run a task" are two different claims, and Studio used to answer
// the second one from the first. Claude Code, Aider and OpenClaw are installed on many machines and
// still have no exercised execution Adapter, so a user could pick one, press prepare and be refused by
// the daemon. The verdict now lives in one place; these cases are the ones that were wrong before.

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Source evidence has one rule here: read the file with whole-line comments removed, so that
// commenting a wiring row out is a failing change rather than a passing one.
const code = (file: string) => readFileSync(`${SRC}/${file}`, 'utf8')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');

const agent = (id: string, over: Partial<AgentDescriptor> = {}): AgentDescriptor => ({
  id,
  name: id,
  source: 'built-in',
  launchCommand: id,
  detected: true,
  version: null,
  detail: '',
  capabilities: [],
  ...over,
});

const profile = (id: string, baseAgentId: string): AgentProfile => ({
  id, name: id, baseAgentId, overrides: {},
  // Timestamps the store requires; irrelevant to the verdict.
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('the execution verdict is not the detection verdict', () => {
  it('refuses an installed Agent whose Adapter has never run a task', () => {
    expect(canRunTasks(agent('claude-code', { adapterStatus: 'candidate' }))).toBe(false);
    expect(canRunTasks(agent('my-cli', { adapterStatus: 'unsupported' }))).toBe(false);
  });

  it('refuses a catalog entry that carries no Adapter status at all', () => {
    // adapterStatus is optional: reading a missing value as "verified" would be the silent-permissive
    // direction, which is the one this product has decided against.
    expect(adapterStatusOf(agent('codex'))).toBe('unsupported');
    expect(canRunTasks(agent('codex'))).toBe(false);
    expect(canRunTasks(undefined)).toBe(false);
  });

  it('refuses a verified Adapter whose CLI is no longer on PATH', () => {
    expect(canRunTasks(agent('codex', { adapterStatus: 'verified', detected: false }))).toBe(false);
  });

  it('accepts only verified plus detected', () => {
    expect(canRunTasks(agent('codex', { adapterStatus: 'verified' }))).toBe(true);
  });

  it('inherits the base Agent verdict for a Profile', () => {
    // Narrowing a prompt or a model is not an execution contract, and a base Agent that left the
    // catalog cannot be vouched for either.
    const agents = [agent('codex', { adapterStatus: 'verified' }), agent('claude-code', { adapterStatus: 'candidate' })];
    expect(canProfileRunTasks(profile('p-codex', 'codex'), agents)).toBe(true);
    expect(canProfileRunTasks(profile('p-claude', 'claude-code'), agents)).toBe(false);
    expect(canProfileRunTasks(profile('p-gone', 'uninstalled'), agents)).toBe(false);
  });

  it('asks one question whichever id kind the selection holds', () => {
    const agents = [agent('codex', { adapterStatus: 'verified' }), agent('aider', { adapterStatus: 'candidate' })];
    const profiles = [profile('p-aider', 'aider')];
    expect(canRunSelectedAgent('codex', agents, profiles)).toBe(true);
    expect(canRunSelectedAgent('p-aider', agents, profiles)).toBe(false);
    // No selection is not a broken selection: the prepare request then leaves the executor to the
    // Blueprint, so this must stay distinguishable from a refused one.
    expect(canRunSelectedAgent(null, agents, profiles)).toBe(false);
    expect(canRunSelectedAgent('unknown', agents, profiles)).toBe(false);
  });

  it('exports no helper that chooses an Agent on the user\'s behalf', () => {
    // A "best default" helper is exactly how the Runtime panel came to name Codex under a Blueprint
    // that had approved someone else. This module answers a question about one Agent; deciding for the
    // user belongs to the user.
    expect(Object.keys(selectability).filter(name => !/^can|^adapter/.test(name))).toEqual([]);
  });
});

// The predicate is worthless if a surface keeps deriving its own answer, so the wiring is pinned here.
// Each row names a place an Agent is offered or chosen; deleting a guard makes its row fail.
describe('every surface that presents an Agent asks the shared question', () => {
  const app = code('App.tsx');

  const SITES: { where: string; evidence: string }[] = [
    { where: 'catalog load', evidence: 'return profiles.some(profile => profile.id === current) ? current : null;' },
    { where: 'capability probe click', evidence: 'if (canRunTasks(agent)) setSelectedAgentId(agent.id);' },
    { where: 'Blueprint Agent radio', evidence: 'const runnable = canRunTasks(agent);' },
    { where: 'Blueprint Profile radio', evidence: 'const runnable = canProfileRunTasks(profile, agents);' },
    { where: 'Profile row selection', evidence: 'onClick={() => { if (runnable) setSelectedAgentId(profile.id); }}' },
    { where: 'Runtime prepare gate', evidence: 'disabled={preparingRuntime || prepareBlocked}' },
  ];

  for (const site of SITES) {
    it(`guards the ${site.where}`, () => {
      // includes() rather than toContain() so a failure names the surface instead of dumping the file.
      expect(app.includes(site.evidence), `${site.where} no longer asks the shared verdict`).toBe(true);
    });
  }

  it('never picks a default Agent after loading the catalog', () => {
    // The row above only proves the guard exists; this one proves nothing replaced it. The fallback
    // used to run whenever the selection was empty, so the first verified Agent in the catalog became
    // the executor of a task nobody had assigned to it.
    expect(app).not.toMatch(/setSelectedAgentId\(\s*(firstRunnable|payload\.agents)/);
    expect(app).not.toContain('firstRunnableAgent');
  });

  it('names the Adapter state instead of printing the enum', () => {
    // `t('agents.adapter', { status: probe.adapterStatus })` rendered "adapter: unsupported" into a
    // Chinese interface; the badge folded two facts into one label.
    expect(app).toContain('t(`agents.adapterStatus.${probe.adapterStatus}` as KeyPath)');
    expect(app).toContain('t(`blueprint.runtimeAdapter.${adapter}` as KeyPath)');
    expect(app).not.toMatch(/t\('agents\.adapter',\s*\{/);
    expect(app).not.toMatch(/t\('blueprint\.runtime(Verified|Candidate)'\)/);
  });

  it('says why an Agent that is installed still cannot be picked', () => {
    // Refusing without a reason reads like a bug; the row has to carry the explanation.
    expect(app.match(/agents\.notExecutable/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
