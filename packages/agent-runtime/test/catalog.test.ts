import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgentRuntimes, resolveExecutablePath } from '../src/index.js';

describe('agent runtime catalog', () => {
  it('returns only detected built-in runtimes', () => {
    const agents = discoverAgentRuntimes();
    expect(agents.every(agent => agent.source === 'built-in')).toBe(true);
    expect(agents.every(agent => agent.detected)).toBe(true);
    expect(agents.every(agent => agent.launchCommand.length > 0)).toBe(true);
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
