import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkspaceRoot } from '../src/index.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function createMonorepo() {
  const root = await mkdtemp(join(tmpdir(), 'agent-dev-root-'));
  directories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['apps/*'] }), 'utf8');
  const packageDirectory = join(root, 'apps', 'daemon');
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'daemon' }), 'utf8');
  return { root, packageDirectory };
}

describe('resolveWorkspaceRoot', () => {
  it('resolves the same root from a workspace package directory as from the root itself', async () => {
    const { root, packageDirectory } = await createMonorepo();
    expect(resolveWorkspaceRoot(packageDirectory)).toBe(root);
    expect(resolveWorkspaceRoot(root)).toBe(root);
  });

  it('falls back to the starting directory when no workspace root exists above it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-dev-orphan-'));
    directories.push(directory);
    expect(resolveWorkspaceRoot(directory)).toBe(directory);
  });

  it('ignores a package manifest that declares no workspaces', async () => {
    const { root, packageDirectory } = await createMonorepo();
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'daemon' }), 'utf8');
    expect(resolveWorkspaceRoot(packageDirectory)).toBe(root);
  });

  it('keeps walking up when a manifest is not valid JSON', async () => {
    const { root, packageDirectory } = await createMonorepo();
    await writeFile(join(packageDirectory, 'package.json'), '{ not json', 'utf8');
    expect(resolveWorkspaceRoot(packageDirectory)).toBe(root);
  });
});
