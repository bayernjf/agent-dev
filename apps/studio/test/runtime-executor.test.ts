import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_NOT_EXECUTABLE_CODE, classifyRuntimeExecutorFailure, withoutProviderNamespace } from '../src/lib/runtime-executor';

// Why this exists: the daemon used to answer "this Agent cannot run the task" by building a Codex
// plan, so the panel showed an executor nobody had picked. It now refuses, and Studio has to say so -
// which means surviving the ambiguity of a 409 that GET .../runtime/plan also uses for "nothing has
// been approved yet". A blank panel is not an answer to a refusal.

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Source evidence has one rule here: read the file with whole-line comments removed, so that
// commenting a wiring row out is a failing change rather than a passing one.
const code = (file: string) => readFileSync(`${SRC}/${file}`, 'utf8')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');

describe('a refused executor is told apart from an empty panel', () => {
  it('carries the same literal the daemon stamps', () => {
    // apps/daemon answers with AGENT_NOT_EXECUTABLE_CODE from @agent-dev/agent-runtime; the browser
    // cannot import that module, so this copy has to be proven equal to the string on the wire.
    expect(AGENT_NOT_EXECUTABLE_CODE).toBe('agent_not_executable');
  });

  it('names the Agent when the response actually says which one', () => {
    expect(classifyRuntimeExecutorFailure(409, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }))
      .toEqual({ kind: 'agent-not-executable', agentId: 'claude-code' });
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
  });

  it('does not read a refusal into another status', () => {
    expect(classifyRuntimeExecutorFailure(500, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }).kind).toBe('other');
    expect(classifyRuntimeExecutorFailure(200, { code: AGENT_NOT_EXECUTABLE_CODE, agentId: 'claude-code' }).kind).toBe('other');
  });
});

// The classifier is dead weight if a request path keeps treating every 409 the same, so both Runtime
// requests are pinned here. Deleting a wiring row makes its case fail - and so does commenting the
// row out, which is what `code` above is for.
describe('both Runtime requests consult the classifier', () => {
  const app = code('App.tsx');

  const SITES: { where: string; evidence: string }[] = [
    { where: 'plan load', evidence: 'const failure = classifyRuntimeExecutorFailure(response.status, rejection);' },
    { where: 'prepare request', evidence: 'const failure = classifyRuntimeExecutorFailure(response.status, payload);' },
    { where: 'inherited refusal gate', evidence: 'const inheritedExecutorRefused = selectedAgentId === null && refusedExecutorAgentId !== null;' },
    { where: 'refusal reason render', evidence: '{prepareBlockedReason && <p className="agent-reason">{prepareBlockedReason}</p>}' },
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
    expect(code('App.tsx')).toContain('nameFor(agentId) ?? nameFor(withoutProviderNamespace(agentId))');
  });
});
