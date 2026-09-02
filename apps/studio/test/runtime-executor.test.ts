import { describe, expect, it } from 'vitest';
import {
  AGENT_NOT_DETECTED_CODE, AGENT_NOT_EXECUTABLE_CODE, classifyRuntimeExecutorFailure, runtimeExecutorId, withoutProviderNamespace,
} from '../src/lib/runtime-executor';
import { readSource } from './source-evidence';

// Why this exists: the daemon used to answer "this Agent cannot run the task" by building a Codex
// plan, so the panel showed an executor nobody had picked. It now refuses, and Studio has to say so -
// which means surviving the ambiguity of a 409 that GET .../runtime/plan also uses for "nothing has
// been approved yet". A blank panel is not an answer to a refusal.

describe('a refused executor is told apart from an empty panel', () => {
  it('carries the same literal the daemon stamps', () => {
    // apps/daemon answers with AGENT_NOT_EXECUTABLE_CODE from @agent-dev/agent-runtime; the browser
    // cannot import that module, so this copy has to be proven equal to the string on the wire.
    expect(AGENT_NOT_EXECUTABLE_CODE).toBe('agent_not_executable');
  });

  it('carries the same literal the daemon stamps for a CLI that is not installed', () => {
    // Same mirroring rule as above, and the second code exists so this sentence is not said about an
    // Agent whose contract is fine and whose binary is simply missing.
    expect(AGENT_NOT_DETECTED_CODE).toBe('agent_not_detected');
  });

  it('names the Agent when the response actually says which one', () => {
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }))
      .toEqual({ kind: 'agent-not-executable', agentId: 'claude-code' });
  });

  it('does not read the missing CLI as the missing contract', () => {
    // Same status, same Agent id, different fact: an unverified Adapter and an uninstalled CLI need
    // different sentences, so the classifier may not collapse them into one kind.
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_DETECTED_CODE, agentId: 'codex' }))
      .toEqual({ kind: 'agent-not-detected', agentId: 'codex' });
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_DETECTED_CODE, agentId: 'codex' }).kind)
      .not.toBe(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'codex' }).kind);
  });

  it('stays quiet on the other 409', () => {
    // "Approve a Feature Task before preparing a Runtime plan." arrives as a bare 409. Inventing a
    // refusal there would tell the user an Agent is broken when the project is only early in the flow.
    expect(classifyRuntimeExecutorFailure(409, {}).kind).toBe('other');
    expect(classifyRuntimeExecutorFailure(409, { error: 'Approve a Feature Task before preparing a Runtime plan.' }).kind).toBe('other');
  });

  it('will not report a refusal it cannot name', () => {
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_EXECUTABLE_CODE }).kind).toBe('other');
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 7 }).kind).toBe('other');
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_DETECTED_CODE }).kind).toBe('other');
  });

  it('does not read a refusal into another status', () => {
    expect(classifyRuntimeExecutorFailure(500, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }).kind).toBe('other');
    expect(classifyRuntimeExecutorFailure(200, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }).kind).toBe('other');
  });
});

// The classifier is dead weight if a request path keeps treating every 409 the same, so both Runtime
// requests are pinned here. Deleting a wiring row makes its case fail - and so does commenting the
// row out, which is what `readSource` in test/source-evidence.ts is for.
describe('both Runtime requests consult the classifier', () => {
  const app = readSource('App.tsx');

  const SITES: { where: string; evidence: string }[] = [
    { where: 'plan load', evidence: 'const failure = classifyRuntimeExecutorFailure(response.status, rejection);' },
    { where: 'prepare request', evidence: 'const failure = classifyRuntimeExecutorFailure(response.status, payload);' },
    { where: 'inherited refusal gate', evidence: 'const inheritedExecutorRefused = selectedAgentId === null && refusedExecutorAgentId !== null;' },
    { where: 'refusal reason render', evidence: '{prepareBlockedReason && <p className="agent-reason">{prepareBlockedReason}</p>}' },
    // The second refusal has its own branch. Falling through to `payload.error` here would print the
    // daemon's English sentence about PATH in an interface that already knows how to say it.
    { where: 'missing-CLI refusal', evidence: "throw new Error(t('runtime.agentNotDetected', { agent: agentDisplayName(failure.agentId) }));" },
  ];

  for (const site of SITES) {
    it(`guards the ${site.where}`, () => {
      expect(app.includes(site.evidence), `${site.where} no longer consults the classifier`).toBe(true);
    });
  }

  it('clears the refusal as soon as its reason is gone', () => {
    // A refusal that outlived its own project would keep blocking Prepare on a blank form, and one
    // that outlived a re-prepared run would deny an Agent while its own panel is healthy. Leaving the
    // project, a successful plan load and a successful prepare each reset it, and the 409 path writes
    // a classifier-derived value that falls back to null, so no path leaves the two states disagreeing.
    expect(app.match(/setRefusedExecutorAgentId\(null\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(app).toContain('setRefusedExecutorAgentId(failure.kind');
  });
});

// A run record written before the executor was normalised carries the Blueprint's `local-` namespace,
// while catalog and Profile rows carry a bare id. The panel has to read both as the same Agent - and
// must not let the strip eat a Profile whose own slug begins with `local-`.
describe('a namespaced executor id still reads as one Agent', () => {
  it('sheds the provider namespace and nothing else', () => {
    expect(withoutProviderNamespace('local-opencode')).toBe('opencode');
    expect(withoutProviderNamespace('opencode')).toBe('opencode');
    // Deliberately dumb: the ordering that protects a Profile id belongs to the lookup in App.tsx.
    expect(withoutProviderNamespace('local-helper')).toBe('helper');
  });

  it('asks for the id as written before asking for the stripped one', () => {
    expect(readSource('App.tsx')).toContain('nameFor(agentId) ?? nameFor(withoutProviderNamespace(agentId))');
  });
});

// Installing an Agent is no decision to use it, so the order below is the whole contract of the
// Runtime panel's header: a run that was prepared, then a click, then the Blueprint a human approved.
describe('the panel names an executor it can account for', () => {
  it('reads the prepared run ahead of anything still on screen', () => {
    expect(runtimeExecutorId({
      runAgentId: 'opencode', selectedAgentId: 'codex', blueprintProvider: 'local-claude-code',
    })).toBe('opencode');
  });

  it('reads an explicit click over the Blueprint', () => {
    // Changing the Agent in the panel is a question about what Prepare will send; the header has to
    // move with it or the two statements contradict each other.
    expect(runtimeExecutorId({ selectedAgentId: 'p-helper', blueprintProvider: 'local-claude-code' }))
      .toBe('p-helper');
  });

  it('inherits the approved Blueprint with the namespace shed', () => {
    // This row replaced "the first installed Agent". A project approved with Claude Code read Codex
    // on screen under the old rule, and Prepare then sent a run for the name it showed.
    expect(runtimeExecutorId({ blueprintProvider: 'local-claude-code' })).toBe('claude-code');
  });

  it('names nobody that it cannot account for', () => {
    expect(runtimeExecutorId({})).toBeNull();
    expect(runtimeExecutorId({ runAgentId: '', selectedAgentId: null, blueprintProvider: undefined })).toBeNull();
  });

  it('hands a legacy namespaced run id over unchanged', () => {
    // The caller looks an id up as written first, so a record prepared before the executor was
    // normalised still names the Agent it names instead of losing it to the strip.
    expect(runtimeExecutorId({ runAgentId: 'local-codex' })).toBe('local-codex');
  });

  it('is the only source the Runtime header prints from', () => {
    const app = readSource('App.tsx');
    const eyebrow = app.match(/<p className="eyebrow">\{t\('runtime\.eyebrow'\)\}[^<]*<\/p>/)?.[0] ?? '';
    expect(eyebrow, 'the Runtime header no longer renders the accounted-for executor').toContain('runtimeExecutorAgentId');
    expect(eyebrow).not.toMatch(/selectedAgentId|agents\[|catalog/);
    // One call site: a surface that re-derives the executor is how a removed fallback comes back.
    expect(app.match(/runtimeExecutorId\(\{/g)?.length).toBe(1);
  });
});
