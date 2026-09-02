import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgentRuntimes, resolveExecutablePath } from '../src/index.js';

describe('agent runtime catalog', () => {
  // What is under test is the filter: a built-in this machine does not have is not returned at all,
  // and one it does have comes back detected with its launch command. Walking the real PATH for that
  // made the answer a fact about the machine — `every()` over an empty array passed on a runner with
  // nothing installed — and cost up to eight sequential 5 s version probes against the 5 s a test is
  // given, which is how this case timed out on a loaded machine. So PATH is a fixture directory
  // holding exactly one built-in command.
  //
  // `detect()` caches per command, so this leaves the other seven built-in names cached as absent for
  // the rest of this file. Every later case here probes a custom fixture command instead, which is
  // what makes that safe; a case that expects a real built-in to be detected must not be added below.
  it('returns only the built-in runtimes this machine has', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-catalog-built-in-'));
    try {
      await writeFile(join(directory, 'opencode'), '#!/bin/sh\necho fixture\n', 'utf8');
      await chmod(join(directory, 'opencode'), 0o755);
      const originalPath = process.env.PATH;
      process.env.PATH = directory;
      try {
        const agents = discoverAgentRuntimes();
        expect(agents.map(agent => agent.id)).toEqual(['opencode']);
        expect(agents[0]).toMatchObject({ source: 'built-in', detected: true, launchCommand: 'opencode' });
        // The fixture is a POSIX script, so cmd.exe cannot run it on Windows. That is not a failure of
        // discovery: PATH presence is the claim, and a version probe that cannot run must not hide an
        // installed Agent. Where it can run, the version it produced is the fixture's own output.
        if (process.platform !== 'win32') expect(agents[0]?.version).toBe('fixture');
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('supports minimal custom Agent configuration', () => {
    const agents = discoverAgentRuntimes([{ name: 'Fixture Agent', launchCommand: 'node' }]);
    expect(agents.at(-1)).toMatchObject({ id: 'custom-1', source: 'custom', name: 'Fixture Agent', launchCommand: 'node', detected: true });
  });

  it('keeps a PATH command visible when its version probe fails', () => {
    const agents = discoverAgentRuntimes([{ name: 'Shell Fixture', launchCommand: 'sh' }]);
    expect(agents.at(-1)).toMatchObject({ detected: true, name: 'Shell Fixture' });
  });

  // Discovery used to shell out to `which`, which does not exist on Windows, and the version probe
  // used to spawn without a shell, which Node refuses to do for an npm .cmd shim (CVE-2024-27980).
  // Together those made a Windows machine report every npm-installed Agent as absent or broken, so
  // this fixture is placed on PATH by hand and both halves are asserted.
  it('detects an installed Agent through PATH and PATHEXT without an external lookup binary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-catalog-'));
    try {
      // An npm install leaves both shapes beside each other on Windows.
      await writeFile(join(directory, 'agent-dev-fixture-cli'), '#!/bin/sh\necho fixture\n', 'utf8');
      await writeFile(join(directory, 'agent-dev-fixture-cli.cmd'), '@echo off\r\necho fixture\r\n', 'utf8');
      const originalPath = process.env.PATH;
      process.env.PATH = directory;
      try {
        const resolved = resolveExecutablePath('agent-dev-fixture-cli');
        expect(resolved).not.toBeNull();
        // Handing cmd.exe the extensionless POSIX script is what made a probe hang until its
        // timeout, so the shim with a Windows extension has to win there. Comparison ignores case
        // on Windows because the candidate is spelled with the upper-case extension PATHEXT carries.
        const expected = process.platform === 'win32'
          ? join(directory, 'agent-dev-fixture-cli.cmd')
          : join(directory, 'agent-dev-fixture-cli');
        expect(process.platform === 'win32' ? resolved?.toLowerCase() : resolved).toBe(
          process.platform === 'win32' ? expected.toLowerCase() : expected,
        );

        const agent = discoverAgentRuntimes([{ name: 'Fixture', launchCommand: 'agent-dev-fixture-cli' }]).at(-1);
        expect(agent?.detected).toBe(true);
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports a command that is genuinely off PATH as absent', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(resolveExecutablePath('node')).toBeNull();
      // Absence is now a completed fact rather than a retryable unknown, so the wording has to
      // stay distinguishable from a probe that ran and merely failed.
      const absent = discoverAgentRuntimes([{ name: 'Off Path', launchCommand: 'agent-dev-off-path-fixture' }]).at(-1);
      expect(absent?.detected).toBe(false);
      expect(absent?.detail).toBe('Command not found on local PATH.');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('resolves an explicit path and answers null when it does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-catalog-path-'));
    try {
      const target = join(directory, 'explicit-cli');
      await writeFile(target, '#!/bin/sh\necho fixture\n', 'utf8');
      expect(resolveExecutablePath(target)).toBe(target);
      expect(resolveExecutablePath(join(directory, 'no-such-cli'))).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
