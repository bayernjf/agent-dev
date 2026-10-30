// ESLint 9 flat config for the agent-dev monorepo.
// TypeScript owns unused/implicit-any via the strict tsconfig (matches the
// model-hub convention). Node code (apps/cli, apps/daemon, packages/*) gets
// Node globals; the studio Vite app gets browser globals.
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/coverage/',
      '**/data/',
      // Experimental scratch code; not part of the shipped workspaces.
      'spikes/',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // `_`-prefixed params/vars are the codebase convention for interface-
      // conformance placeholders (e.g. adapters that ignore cwd).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/studio/src/**/*.{ts,tsx}', 'apps/studio/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);
