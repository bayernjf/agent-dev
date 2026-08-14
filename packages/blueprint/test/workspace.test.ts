import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDefaultBlueprint, generateArtifacts } from '../src/index.js';
import { verifyWorkspaceArtifacts } from '../src/workspace.js';

const blueprint = createDefaultBlueprint('Receipt Desk');

async function writeAllArtifacts(root: string): Promise<void> {
  for (const artifact of generateArtifacts(blueprint)) {
    const target = join(root, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.content, 'utf8');
  }
}

describe('verifyWorkspaceArtifacts', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-dev-workspace-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('accepts a workspace produced by the current generator', async () => {
    await writeAllArtifacts(workspace);

    const result = await verifyWorkspaceArtifacts(workspace, blueprint);

    expect(result.usable).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.staleConfig).toEqual([]);
  });

  it('rejects a workspace whose directory does not exist', async () => {
    const result = await verifyWorkspaceArtifacts(join(workspace, 'absent'), blueprint);

    expect(result.usable).toBe(false);
    expect(result.workspaceMissing).toBe(true);
    expect(result.reason).toContain('re-run Apply');
  });

  it('rejects a workspace with deployment configuration from an older generator', async () => {
    await writeAllArtifacts(workspace);
    await writeFile(join(workspace, 'apps/api/vercel.json'), JSON.stringify({
      version: 2,
      functions: { 'src/index.ts': { runtime: 'nodejs22.x' } },
    }, null, 2) + '\n', 'utf8');

    const result = await verifyWorkspaceArtifacts(workspace, blueprint);

    expect(result.usable).toBe(false);
    expect(result.staleConfig).toEqual(['apps/api/vercel.json']);
    expect(result.reason).toContain('older generator');
  });

  it('ignores application source changed by agent feature work', async () => {
    await writeAllArtifacts(workspace);
    await writeFile(join(workspace, 'apps/web/src/main.tsx'), '// implemented by a coding agent\n', 'utf8');

    const result = await verifyWorkspaceArtifacts(workspace, blueprint);

    expect(result.usable).toBe(true);
    expect(result.staleConfig).toEqual([]);
  });

  it('reports individually missing artifacts without claiming the whole workspace is gone', async () => {
    await writeAllArtifacts(workspace);
    await rm(join(workspace, 'wrangler.toml'));

    const result = await verifyWorkspaceArtifacts(workspace, blueprint);

    expect(result.usable).toBe(false);
    expect(result.workspaceMissing).toBe(false);
    expect(result.missing).toEqual(['wrangler.toml']);
  });
});
