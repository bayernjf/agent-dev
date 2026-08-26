import { describe, expect, it } from 'vitest';
import { classifyFailure, categoryLabel, severityLabel } from '../src/failure-classification.js';

describe('failure classification', () => {
  describe('environment category', () => {
    it('classifies Node version errors', () => {
      const result = classifyFailure('npm ci failed: engine Unsupported engine requires node >=22');
      expect(result.category).toBe('environment');
      expect(result.title).toContain('Node.js');
      expect(result.autoRetryable).toBe(false);
    });

    it('classifies missing agent CLI', () => {
      const result = classifyFailure('codex: command not found on local PATH');
      expect(result.category).toBe('environment');
      expect(result.title).toContain('Coding agent');
    });

    it('classifies network failures as recoverable', () => {
      const result = classifyFailure('fetch failed: ECONNREFUSED');
      expect(result.category).toBe('environment');
      expect(result.autoRetryable).toBe(true);
    });

    it('classifies workspace recovery needs', () => {
      const result = classifyFailure('workspace is unusable: staleConfig detected');
      expect(result.category).toBe('environment');
      expect(result.title).toContain('Workspace');
    });

    it('classifies dependency installation failures', () => {
      const result = classifyFailure('dependencies installation error: ERESOLVE unable to resolve peer dependency tree');
      expect(result.category).toBe('environment');
      expect(result.title).toContain('Dependency');
    });
  });

  describe('configuration category', () => {
    it('classifies git repository issues', () => {
      const result = classifyFailure('fatal: not a git repository');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('Git');
    });

    it('classifies secret leak blocks', () => {
      const result = classifyFailure('Blocked commit: .env file found in staged changes');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('Secret');
    });

    it('classifies quality gate failures', () => {
      const result = classifyFailure('npm error Missing script: "typecheck"');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('Quality gate');
    });

    it('classifies CORS issues', () => {
      const result = classifyFailure('access-control-allow-origin mismatch');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('CORS');
    });

    it('classifies schema migration errors', () => {
      const result = classifyFailure('ZodError: missing required field desktopShell');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('schema');
    });

    it('classifies cloud resource mismatches', () => {
      const result = classifyFailure('deployment target none: product type does not require Vercel');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('Cloud resource');
    });

    it('classifies external symlink blocks', () => {
      const result = classifyFailure('Blocked: symbolic link points outside workspace');
      expect(result.category).toBe('configuration');
      expect(result.title).toContain('symlink');
    });
  });

  describe('platform category', () => {
    it('classifies PR creation failures', () => {
      const result = classifyFailure('pull request creation failed: gh auth token expired');
      expect(result.category).toBe('platform');
      expect(result.title).toContain('Pull request');
    });

    it('classifies deployment failures as recoverable', () => {
      const result = classifyFailure('vercel deployment error: invalid project configuration');
      expect(result.category).toBe('platform');
      expect(result.autoRetryable).toBe(true);
    });

    it('classifies agent execution failures', () => {
      const result = classifyFailure('codex exited with non-zero exit code 1');
      expect(result.category).toBe('platform');
      expect(result.title).toContain('agent execution');
    });
  });

  describe('product category', () => {
    it('classifies approval requirements', () => {
      const result = classifyFailure('approval required before production release');
      expect(result.category).toBe('product');
      expect(result.title).toContain('Approval');
    });

    it('classifies missing feature tasks', () => {
      const result = classifyFailure('no feature task exists for this project');
      expect(result.category).toBe('product');
      expect(result.title).toContain('Feature task');
    });

    it('classifies production branch mismatches', () => {
      const result = classifyFailure('accepted commit is not an ancestor of main branch');
      expect(result.category).toBe('product');
      expect(result.title).toContain('Production branch');
      expect(result.relatedDefects).toContain(9);
    });
  });

  describe('fallback classification', () => {
    it('returns unknown for unrecognized errors', () => {
      const result = classifyFailure('something completely unexpected happened');
      expect(result.category).toBe('unknown');
      expect(result.title).toContain('unexpected');
    });

    it('uses context for step-based fallback', () => {
      const result = classifyFailure('weird error', { step: 'release-deploy' });
      expect(result.category).toBe('platform');
      expect(result.title).toContain('Release');
    });
  });

  describe('labels', () => {
    it('returns human-readable category labels', () => {
      expect(categoryLabel('environment')).toContain('Environment');
      expect(categoryLabel('configuration')).toContain('Configuration');
      expect(categoryLabel('platform')).toContain('Platform');
      expect(categoryLabel('product')).toContain('Process');
      expect(categoryLabel('unknown')).toContain('Unknown');
    });

    it('returns human-readable severity labels', () => {
      expect(severityLabel('blocking')).toContain('Blocking');
      expect(severityLabel('recoverable')).toContain('Recoverable');
      expect(severityLabel('warning')).toContain('Warning');
    });
  });

  describe('remediation quality', () => {
    it('every classification has at least one remediation step', () => {
      const testCases = [
        'npm ci failed: engine error',
        'codex not found',
        'fetch failed ECONNREFUSED',
        'not a git repository',
        '.env blocked commit',
        'Missing script typecheck',
        'CORS origin mismatch',
        'gh pr create failed',
        'vercel deploy timeout',
        'codex exit code 1',
        'approval required',
        'no feature task',
        'commit not ancestor of main',
        'workspace unusable staleConfig',
        'ZodError missing field',
        'cloud resource mismatch',
        'external symlink blocked',
        'npm install ERESOLVE',
      ];
      for (const msg of testCases) {
        const result = classifyFailure(msg);
        expect(result.remediation.length).toBeGreaterThan(0, `No remediation for: ${msg}`);
      }
    });

    it('every classification has a non-empty title and explanation', () => {
      const result = classifyFailure('test error');
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.explanation.length).toBeGreaterThan(0);
    });
  });
});
