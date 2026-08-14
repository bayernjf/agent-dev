import { defineConfig } from 'vitest/config';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packagesDir = resolve(__dirname, 'packages');
const appsDir = resolve(__dirname, 'apps');

// Vitest cannot resolve the `file:` protocol workspace links npm creates, so every internal package
// is aliased to its directory. Subpath entries must come first: alias matching is prefix-based, so a
// bare `@agent-dev/blueprint` rule would otherwise rewrite `@agent-dev/blueprint/workspace` to a
// directory-relative path that does not exist.
function collectWorkspaceAliases(): Array<{ find: string; replacement: string }> {
  const subpaths: Array<{ find: string; replacement: string }> = [
    { find: '@agent-dev/blueprint/workspace', replacement: join(packagesDir, 'blueprint', 'src', 'workspace.ts') },
  ];
  const packages: Array<{ find: string; replacement: string }> = [];
  for (const dir of [packagesDir, appsDir]) {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      if (!statSync(fullPath).isDirectory()) continue;
      packages.push({ find: `@agent-dev/${name}`, replacement: fullPath });
    }
  }
  return [...subpaths, ...packages];
}

export default defineConfig({
  resolve: {
    alias: collectWorkspaceAliases(),
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // Runtime catalog tests probe real local CLIs; parallel files can starve
    // synchronous child-process probes and create false timeout failures.
    fileParallelism: false,
  },
});
