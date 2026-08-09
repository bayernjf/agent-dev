import { defineConfig } from 'vitest/config';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packagesDir = resolve(__dirname, 'packages');
const appsDir = resolve(__dirname, 'apps');

function collectWorkspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const dir of [packagesDir, appsDir]) {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      if (!statSync(fullPath).isDirectory()) continue;
      aliases[`@agent-dev/${name}`] = fullPath;
    }
  }
  return aliases;
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
