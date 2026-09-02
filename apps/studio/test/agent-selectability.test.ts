import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adapterStatusOf, canProfileRunTasks, canRunSelectedAgent, canRunTasks, firstRunnableAgent,
} from '../src/lib/agent-selectability';
import type { AgentDescriptor, AgentProfile } from '../src/types';

// Why this exists: "detected" and "can run a task" are two different claims, and Studio used to answer
// the second one from the first. Claude Code, Aider and OpenClaw are installed on many machines and
// still have no exercised execution Adapter, so a user could pick one, press prepare and be refused by
// the daemon. The verdict now lives in one place; these cases are the ones that were wrong before.

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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

  it('picks past an installed candidate when choosing for the user', () => {
    const catalog = [
      agent('claude-code', { adapterStatus: 'candidate' }),
      agent('aider', { adapterStatus: 'unsupported' }),
      agent('codex', { adapterStatus: 'verified' }),
    ];
    // The old default was `find(agent => agent.detected)`, which landed on Claude Code, then fell
    // through to catalog[0] when nothing was installed.
    expect(firstRunnableAgent(catalog)?.id).toBe('codex');
    expect(firstRunnableAgent(catalog.slice(0, 2))).toBeUndefined();
    expect(firstRunnableAgent([])).toBeUndefined();
  });
});

// The predicate is worthless if a surface keeps deriving its own answer, so the wiring is pinned here.
// Each row names a place an Agent is offered or chosen; deleting a guard makes its row fail.
describe('every surface that presents an Agent asks the shared question', () => {
  const app = readFileSync(`${SRC}/App.tsx`, 'utf8');

  const SITES: { where: string; evidence: string }[] = [
    { where: 'catalog auto-select', evidence: 'return firstRunnableAgent(payload.agents)?.id ?? null;' },
    { where: 'capability probe click', evidence: 'if (canRunTasks(agent)) setSelectedAgentId(agent.id);' },
    { where: 'Blueprint Agent radio', evidence: 'const runnable = canRunTasks(agent);' },
    { where: 'Blueprint Profile radio', evidence: 'const runnable = canProfileRunTasks(profile, agents);' },
    { where: 'Profile row selection', evidence: 'onClick={() => { if (runnable) setSelectedAgentId(profile.id); }}' },
    { where: 'Runtime prepare gate', evidence: 'disabled={preparingRuntime || selectionBlocked}' },
  ];

  for (const site of SITES) {
    it(`guards the ${site.where}`, () => {
      // includes() rather than toContain() so a failure names the surface instead of dumping the file.
      expect(app.includes(site.evidence), `${site.where} no longer asks the shared verdict`).toBe(true);
    });
  }

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
