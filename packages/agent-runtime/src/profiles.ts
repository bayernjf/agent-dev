import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentProfileOverrides = {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  env?: Record<string, string>;
  allowedTools?: string[];
  blockedTools?: string[];
  maxTokens?: number;
};

export type AgentProfile = {
  id: string;
  name: string;
  description?: string;
  baseAgentId: string;
  icon?: string;
  overrides: AgentProfileOverrides;
  createdAt: string;
  updatedAt: string;
};

// Resolved configuration after merging base agent defaults + profile overrides.
export type ResolvedAgentConfig = {
  baseAgentId: string;
  profileId?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  env: Record<string, string>;
  allowedTools?: string[];
  blockedTools: string[];
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const agentProfileOverridesSchema = z.object({
  systemPrompt: z.string().max(10_000).optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  env: z.record(z.string().max(200), z.string().max(2000)).refine(obj => Object.keys(obj).length <= 50, 'Maximum 50 environment variables').optional(),
  allowedTools: z.array(z.string().max(100)).max(100).optional(),
  blockedTools: z.array(z.string().max(100)).max(100).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
});

export const agentProfileSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/, 'Profile ID must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  overrides: agentProfileOverridesSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const agentProfileCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  overrides: agentProfileOverridesSchema.default({}),
});

export const agentProfileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  overrides: agentProfileOverridesSchema.optional(),
});

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function slugifyProfileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function ensureUniqueProfileId(baseId: string, existingIds: string[]): string {
  if (!existingIds.includes(baseId)) return baseId;
  let counter = 2;
  while (existingIds.includes(`${baseId}-${counter}`)) counter++;
  return `${baseId}-${counter}`;
}

// ---------------------------------------------------------------------------
// Config merging
// ---------------------------------------------------------------------------

export type BaseAgentDefaults = {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  env?: Record<string, string>;
  supportedTools?: string[];
  defaultAllowedTools?: string[];
};

const SAFE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM',
  'TMPDIR', 'TMP', 'TEMP', 'NO_COLOR', 'HTTP_PROXY', 'HTTPS_PROXY',
  'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
]);

export function filterSafeEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SAFE_ENV_KEYS.has(key)) result[key] = value;
  }
  return result;
}

export function mergeAgentConfig(
  base: BaseAgentDefaults,
  profile?: AgentProfile,
  projectOverrides?: AgentProfileOverrides,
): ResolvedAgentConfig {
  // System prompt: base + profile + project (concatenated)
  const systemPromptParts: string[] = [];
  if (base.systemPrompt) systemPromptParts.push(base.systemPrompt);
  if (profile?.overrides.systemPrompt) systemPromptParts.push(profile.overrides.systemPrompt);
  if (projectOverrides?.systemPrompt) systemPromptParts.push(projectOverrides.systemPrompt);

  // Scalar fields: higher priority overrides lower
  const model = projectOverrides?.model ?? profile?.overrides.model ?? base.model;
  const temperature = projectOverrides?.temperature ?? profile?.overrides.temperature ?? base.temperature;
  const maxTokens = projectOverrides?.maxTokens ?? profile?.overrides.maxTokens ?? base.maxTokens;

  // Env: merge, higher priority overrides lower, filtered by safe keys
  const env: Record<string, string> = { ...filterSafeEnv(base.env ?? {}) };
  if (profile?.overrides.env) Object.assign(env, filterSafeEnv(profile.overrides.env));
  if (projectOverrides?.env) Object.assign(env, filterSafeEnv(projectOverrides.env));

  // Allowed tools: intersection of all layers (any layer narrows the set)
  let allowedTools: string[] | undefined = base.defaultAllowedTools;
  if (profile?.overrides.allowedTools) {
    allowedTools = allowedTools
      ? allowedTools.filter(t => profile.overrides.allowedTools!.includes(t))
      : profile.overrides.allowedTools;
  }
  if (projectOverrides?.allowedTools) {
    allowedTools = allowedTools
      ? allowedTools.filter(t => projectOverrides.allowedTools!.includes(t))
      : projectOverrides.allowedTools;
  }
  // Further restrict to tools the base agent actually supports
  if (allowedTools && base.supportedTools) {
    allowedTools = allowedTools.filter(t => base.supportedTools!.includes(t));
  }

  // Blocked tools: union of all layers
  const blockedTools = new Set<string>([
    ...(profile?.overrides.blockedTools ?? []),
    ...(projectOverrides?.blockedTools ?? []),
  ]);

  return {
    baseAgentId: profile?.baseAgentId ?? 'unknown',
    profileId: profile?.id,
    systemPrompt: systemPromptParts.join('\n\n'),
    model,
    temperature,
    maxTokens,
    env,
    allowedTools,
    blockedTools: Array.from(blockedTools),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateProfileTools(
  profile: Pick<AgentProfile, 'overrides'>,
  supportedTools: string[],
): { valid: boolean; invalidTools: string[] } {
  const allowed = profile.overrides.allowedTools ?? [];
  const invalidTools = allowed.filter(t => !supportedTools.includes(t));
  return { valid: invalidTools.length === 0, invalidTools };
}

export function validateProfileEnv(profile: Pick<AgentProfile, 'overrides'>): { valid: boolean; unsafeKeys: string[] } {
  const env = profile.overrides.env ?? {};
  const unsafeKeys = Object.keys(env).filter(k => !SAFE_ENV_KEYS.has(k));
  return { valid: unsafeKeys.length === 0, unsafeKeys };
}
