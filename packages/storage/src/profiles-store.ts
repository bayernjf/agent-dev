import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type AgentProfile,
  agentProfileSchema,
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
  slugifyProfileName,
  ensureUniqueProfileId,
  validateProfileTools,
  validateProfileEnv,
} from '@agent-dev/agent-runtime';

export type CreateProfileInput = {
  name: string;
  description?: string;
  baseAgentId: string;
  icon?: string;
  overrides?: AgentProfile['overrides'];
};

export type UpdateProfileInput = {
  name?: string;
  description?: string;
  icon?: string;
  overrides?: AgentProfile['overrides'];
};

export type ProfileValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Stores user-level Agent Profiles in a JSON file next to the main database.
 * Profiles are user-level, not project-level — they can be selected as the
 * runtime agent for any project.
 */
export class ProfileStore {
  private readonly filePath: string;
  private cache: AgentProfile[] | null = null;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'agent-profiles.json');
  }

  async listProfiles(): Promise<AgentProfile[]> {
    if (this.cache) return this.cache;
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  async getProfile(id: string): Promise<AgentProfile | null> {
    const profiles = await this.listProfiles();
    return profiles.find(p => p.id === id) ?? null;
  }

  async getProfilesByBaseAgent(baseAgentId: string): Promise<AgentProfile[]> {
    const profiles = await this.listProfiles();
    return profiles.filter(p => p.baseAgentId === baseAgentId);
  }

  async createProfile(
    input: CreateProfileInput,
    options: { supportedTools?: string[]; verifyBaseAgent?: (id: string) => boolean } = {},
  ): Promise<{ profile: AgentProfile; validation: ProfileValidationResult }> {
    const parsed = agentProfileCreateSchema.parse(input);
    const existing = await this.listProfiles();
    const existingIds = existing.map(p => p.id);

    const baseId = slugifyProfileName(parsed.name);
    const id = ensureUniqueProfileId(baseId, existingIds);

    const now = new Date().toISOString();
    const profile: AgentProfile = {
      id,
      name: parsed.name,
      description: parsed.description,
      baseAgentId: parsed.baseAgentId,
      icon: parsed.icon,
      overrides: parsed.overrides ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const validation = this.validateProfile(profile, options);
    if (!validation.valid) {
      return { profile, validation };
    }

    existing.push(profile);
    await this.saveToDisk(existing);
    this.cache = existing;
    return { profile, validation };
  }

  async updateProfile(
    id: string,
    input: UpdateProfileInput,
    options: { supportedTools?: string[] } = {},
  ): Promise<{ profile: AgentProfile | null; validation: ProfileValidationResult }> {
    const parsed = agentProfileUpdateSchema.parse(input);
    const profiles = await this.listProfiles();
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return { profile: null, validation: { valid: false, errors: ['Profile not found'] } };

    const updated: AgentProfile = {
      ...profiles[index],
      ...parsed,
      overrides: parsed.overrides ?? profiles[index].overrides,
      updatedAt: new Date().toISOString(),
    };

    const validation = this.validateProfile(updated, options);
    if (!validation.valid) {
      return { profile: updated, validation };
    }

    profiles[index] = updated;
    await this.saveToDisk(profiles);
    this.cache = profiles;
    return { profile: updated, validation };
  }

  async deleteProfile(id: string): Promise<boolean> {
    const profiles = await this.listProfiles();
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return false;
    profiles.splice(index, 1);
    await this.saveToDisk(profiles);
    this.cache = profiles;
    return true;
  }

  /** Check if any profile references the given base agent. Used before deleting/downgrading a base agent. */
  async hasProfilesForBaseAgent(baseAgentId: string): Promise<boolean> {
    const profiles = await this.listProfiles();
    return profiles.some(p => p.baseAgentId === baseAgentId);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private validateProfile(
    profile: AgentProfile,
    options: { supportedTools?: string[]; verifyBaseAgent?: (id: string) => boolean },
  ): ProfileValidationResult {
    const errors: string[] = [];

    // Base agent must be verified (if verifier provided)
    if (options.verifyBaseAgent && !options.verifyBaseAgent(profile.baseAgentId)) {
      errors.push(`Base agent "${profile.baseAgentId}" is not verified. Profiles can only be based on verified agents.`);
    }

    // Tools must be subset of supported tools
    if (options.supportedTools && profile.overrides.allowedTools) {
      const toolResult = validateProfileTools(profile, options.supportedTools);
      if (!toolResult.valid) {
        errors.push(`Tools not supported by base agent: ${toolResult.invalidTools.join(', ')}`);
      }
    }

    // Env keys must be safe
    const envResult = validateProfileEnv(profile);
    if (!envResult.valid) {
      errors.push(`Unsafe environment variable keys: ${envResult.unsafeKeys.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  private async loadFromDisk(): Promise<AgentProfile[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(item => {
          try {
            return agentProfileSchema.parse(item);
          } catch {
            return null;
          }
        })
        .filter((p): p is AgentProfile => p !== null);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  private async saveToDisk(profiles: AgentProfile[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(profiles, null, 2) + '\n', 'utf8');
  }
}
