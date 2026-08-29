import { describe, expect, it } from 'vitest';
import {
  agentProfileCreateSchema,
  agentProfileSchema,
  ensureUniqueProfileId,
  filterSafeEnv,
  mergeAgentConfig,
  slugifyProfileName,
  validateProfileEnv,
  validateProfileTools,
  type AgentProfile,
} from '../src/index.js';

function makeProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'frontend-expert',
    name: 'Frontend Expert',
    baseAgentId: 'codex',
    overrides: {},
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('slugifyProfileName', () => {
  it('normalizes case and joins words with hyphens', () => {
    expect(slugifyProfileName('Codex · Frontend Expert')).toBe('codex-frontend-expert');
    expect(slugifyProfileName('Frontend_Expert')).toBe('frontend-expert');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugifyProfileName('- Codex -')).toBe('codex');
  });

  it('truncates to 80 characters', () => {
    expect(slugifyProfileName('a'.repeat(120))).toHaveLength(80);
  });

  it('returns an empty string for names with no slug characters', () => {
    expect(slugifyProfileName('🎨 🚀')).toBe('');
  });
});

describe('ensureUniqueProfileId', () => {
  it('keeps the base id when it is not taken', () => {
    expect(ensureUniqueProfileId('codex', ['a', 'b'])).toBe('codex');
  });

  it('appends -2 when the base id is taken', () => {
    expect(ensureUniqueProfileId('codex', ['codex'])).toBe('codex-2');
  });

  it('increments until a free id is found', () => {
    expect(ensureUniqueProfileId('codex', ['codex', 'codex-2', 'codex-3'])).toBe('codex-4');
  });
});

describe('filterSafeEnv', () => {
  it('keeps only keys on the safe allowlist', () => {
    const result = filterSafeEnv({ PATH: '/usr/bin', SECRET_TOKEN: 'sk-123', HOME: '/home/u', OPENAI_API_KEY: 'x' });
    expect(result).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
  });

  it('returns an empty object for all-unsafe input', () => {
    expect(filterSafeEnv({ FOO: '1', BAR: '2' })).toEqual({});
  });
});

describe('mergeAgentConfig', () => {
  const base = {
    systemPrompt: 'You are a coding agent.',
    model: 'default-model',
    temperature: 1,
    maxTokens: 8000,
    env: { PATH: '/usr/bin', OPENAI_API_KEY: 'base-key' },
    defaultAllowedTools: ['Read', 'Write', 'Bash'],
    supportedTools: ['Read', 'Write', 'Edit', 'Bash'],
  };

  it('resolves unknown base agent when no profile is given', () => {
    const resolved = mergeAgentConfig({});
    expect(resolved).toMatchObject({ baseAgentId: 'unknown', profileId: undefined });
  });

  it('concatenates system prompts in base -> profile -> project order', () => {
    const profile = makeProfile({ overrides: { systemPrompt: 'You are a React expert.' } });
    const resolved = mergeAgentConfig(base, profile, { systemPrompt: 'Focus on tests.' });
    expect(resolved.systemPrompt).toBe('You are a coding agent.\n\nYou are a React expert.\n\nFocus on tests.');
  });

  it('applies scalar overrides with project highest priority', () => {
    const profile = makeProfile({ overrides: { model: 'profile-model', temperature: 0.5 } });
    const resolved = mergeAgentConfig(base, profile, { model: 'project-model', maxTokens: 16000 });
    expect(resolved).toMatchObject({ model: 'project-model', temperature: 0.5, maxTokens: 16000 });
  });

  it('falls back through profile then base for missing scalars', () => {
    const profile = makeProfile({ overrides: { temperature: 0.3 } });
    const resolved = mergeAgentConfig(base, profile);
    expect(resolved).toMatchObject({ model: 'default-model', temperature: 0.3, maxTokens: 8000 });
  });

  it('merges env by layer and drops keys not on the safe allowlist', () => {
    // Credential-style keys are intentionally not on the allowlist: secrets are injected through
    // the credentials system, never through profile env. Only proxy/locale-style keys survive.
    const profile = makeProfile({ overrides: { env: { PATH: '/custom/bin', OPENAI_API_KEY: 'profile-key', MY_SECRET: 'no' } } });
    const resolved = mergeAgentConfig(base, profile, { env: { OPENAI_API_KEY: 'project-key' } });
    expect(resolved.env).toEqual({ PATH: '/custom/bin' });
  });

  it('intersects allowed tools across every layer and restricts to supported tools', () => {
    const profile = makeProfile({ overrides: { allowedTools: ['Read', 'Bash', 'Edit'] } });
    const resolved = mergeAgentConfig(base, profile, { allowedTools: ['Read', 'Bash'] });
    expect(resolved.allowedTools).toEqual(['Read', 'Bash']);
  });

  it('restricts allowed tools to the base supported set', () => {
    const profile = makeProfile({ overrides: { allowedTools: ['Read', 'NotSupported'] } });
    const resolved = mergeAgentConfig(base, profile);
    expect(resolved.allowedTools).toEqual(['Read']);
  });

  it('uses the profile allowed tools when base has no defaults', () => {
    const profile = makeProfile({ overrides: { allowedTools: ['Read', 'Write'] } });
    const resolved = mergeAgentConfig({ systemPrompt: 'x' }, profile);
    expect(resolved.allowedTools).toEqual(['Read', 'Write']);
  });

  it('unions blocked tools across layers', () => {
    const profile = makeProfile({ overrides: { blockedTools: ['Bash'] } });
    const resolved = mergeAgentConfig(base, profile, { blockedTools: ['Edit'] });
    expect(resolved.blockedTools).toEqual(['Bash', 'Edit']);
  });

  it('resolves profile base agent id and carries the profile id', () => {
    const profile = makeProfile({ baseAgentId: 'codex' });
    const resolved = mergeAgentConfig(base, profile);
    expect(resolved).toMatchObject({ baseAgentId: 'codex', profileId: 'frontend-expert' });
  });
});

describe('validateProfileTools', () => {
  it('accepts tools the base agent supports', () => {
    const profile = makeProfile({ overrides: { allowedTools: ['Read', 'Bash'] } });
    expect(validateProfileTools(profile, ['Read', 'Write', 'Bash'])).toEqual({ valid: true, invalidTools: [] });
  });

  it('reports tools the base agent does not support', () => {
    const profile = makeProfile({ overrides: { allowedTools: ['Read', 'Deploy'] } });
    expect(validateProfileTools(profile, ['Read', 'Write'])).toEqual({ valid: false, invalidTools: ['Deploy'] });
  });
});

describe('validateProfileEnv', () => {
  it('accepts only safe env keys', () => {
    const profile = makeProfile({ overrides: { env: { PATH: '/usr/bin' } } });
    expect(validateProfileEnv(profile)).toEqual({ valid: true, unsafeKeys: [] });
  });

  it('reports unsafe env keys', () => {
    const profile = makeProfile({ overrides: { env: { PATH: '/usr/bin', DATABASE_URL: 'postgres://...' } } });
    expect(validateProfileEnv(profile)).toEqual({ valid: false, unsafeKeys: ['DATABASE_URL'] });
  });
});

describe('profile schemas', () => {
  it('parses a valid create input with defaults', () => {
    const parsed = agentProfileCreateSchema.parse({ name: 'Frontend Expert', baseAgentId: 'codex' });
    expect(parsed.overrides).toEqual({});
  });

  it('rejects a temperature outside the 0..2 range', () => {
    expect(() => agentProfileCreateSchema.parse({ name: 'X', baseAgentId: 'codex', overrides: { temperature: 2.5 } })).toThrow();
    expect(() => agentProfileCreateSchema.parse({ name: 'X', baseAgentId: 'codex', overrides: { temperature: -0.1 } })).toThrow();
  });

  it('rejects a profile id with uppercase letters or underscores', () => {
    expect(agentProfileSchema.safeParse(makeProfile({ id: 'valid-id' })).success).toBe(true);
    expect(agentProfileSchema.safeParse(makeProfile({ id: 'Invalid_ID' })).success).toBe(false);
  });

  it('rejects more than 50 env variables', () => {
    const env: Record<string, string> = {};
    for (let i = 0; i < 51; i++) env[`KEY_${i}`] = 'value';
    expect(() => agentProfileCreateSchema.parse({ name: 'X', baseAgentId: 'codex', overrides: { env } })).toThrow();
  });

  it('rejects a maxTokens outside the 1..1_000_000 range', () => {
    expect(() => agentProfileCreateSchema.parse({ name: 'X', baseAgentId: 'codex', overrides: { maxTokens: 0 } })).toThrow();
    expect(() => agentProfileCreateSchema.parse({ name: 'X', baseAgentId: 'codex', overrides: { maxTokens: 2_000_000 } })).toThrow();
  });
});
