import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineStep = {
  id: string;
  name: string;
  /** Agent Profile ID to use for this step. Must resolve to a verified base agent. */
  profileId: string;
  /** Prompt template for this step. May reference previous step outputs via {{step:step-id.output}}. */
  prompt: string;
  /** Step IDs this step depends on. Defaults to the immediately preceding step. */
  dependsOn?: string[];
  /** Optional file path where this step's output artifact should be written/read. */
  outputArtifact?: string;
  /** If true, continue to next step even if this step fails. Default false. */
  continueOnFailure?: boolean;
  /** If true, pause for human approval before executing this step. Default false. */
  requiresApproval?: boolean;
};

export type PipelineStepResult = {
  stepId: string;
  status: PipelineStepStatus;
  /** Output summary from this step's execution (truncated). */
  output?: string;
  /** Associated RuntimeRun ID. */
  runtimeRunId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type FeatureTaskPipeline = {
  steps: PipelineStep[];
  currentStepIndex: number;
  results: PipelineStepResult[];
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  startedAt?: string;
  completedAt?: string;
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const pipelineStepSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  profileId: z.string().min(1).max(120),
  prompt: z.string().min(1).max(10_000),
  dependsOn: z.array(z.string()).optional(),
  outputArtifact: z.string().max(500).optional(),
  continueOnFailure: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

export const featureTaskPipelineSchema = z.object({
  steps: z.array(pipelineStepSchema).min(1).max(20),
  currentStepIndex: z.number().int().min(0).default(0),
  results: z.array(z.object({
    stepId: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    output: z.string().optional(),
    runtimeRunId: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    error: z.string().optional(),
  })).default([]),
  status: z.enum(['idle', 'running', 'completed', 'failed', 'paused']).default('idle'),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const createPipelineStepSchema = z.object({
  name: z.string().min(1).max(100),
  profileId: z.string().min(1).max(120),
  prompt: z.string().min(1).max(10_000),
  dependsOn: z.array(z.string()).optional(),
  outputArtifact: z.string().max(500).optional(),
  continueOnFailure: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve prompt template by replacing {{step:step-id.output}} placeholders
 * with the actual output from previous steps.
 */
export function resolvePipelinePrompt(
  prompt: string,
  results: PipelineStepResult[],
): string {
  return prompt.replace(/\{\{step:([^}]+)\.output\}\}/g, (_, stepId) => {
    const result = results.find(r => r.stepId === stepId);
    return result?.output ?? `[step ${stepId} output not available]`;
  });
}

/**
 * Get the next step to execute based on dependencies and current results.
 * Returns null if all steps are complete or no step is ready.
 */
export function getNextPipelineStep(
  steps: PipelineStep[],
  results: PipelineStepResult[],
): PipelineStep | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const result = results.find(r => r.stepId === step.id);
    if (result && (result.status === 'completed' || result.status === 'skipped')) continue;
    if (result && result.status === 'running') return step;
    if (result && result.status === 'failed' && !step.continueOnFailure) return null;

    // Check dependencies
    const deps = step.dependsOn ?? (i > 0 ? [steps[i - 1]!.id] : []);
    const depsMet = deps.every(depId => {
      const depResult = results.find(r => r.stepId === depId);
      return depResult && (depResult.status === 'completed' || depResult.status === 'skipped');
    });
    if (depsMet) return step;
  }
  return null;
}

/** Check if all steps are completed (or skipped). */
export function isPipelineComplete(steps: PipelineStep[], results: PipelineStepResult[]): boolean {
  return steps.every(step => {
    const result = results.find(r => r.stepId === step.id);
    return result && (result.status === 'completed' || result.status === 'skipped');
  });
}

/** Check if the pipeline has any failed step that blocks continuation. */
export function isPipelineBlocked(steps: PipelineStep[], results: PipelineStepResult[]): boolean {
  return results.some(r => r.status === 'failed') &&
    !steps.every(step => {
      const result = results.find(r => r.stepId === step.id);
      if (!result) return false;
      if (result.status === 'failed') return step.continueOnFailure === true;
      return result.status === 'completed' || result.status === 'skipped';
    });
}
