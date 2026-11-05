// Browser-safe subset of `@agent-dev/blueprint`: every export here is either a pure helper or a type,
// and none of them pull zod into the bundle. Studio imports from this sub-path so reading a
// blueprint object does not ship the schema runtime it never calls.
export {
  baselineProvidersFor,
  createBaselinePlan,
  createDryRunPlan,
  generateArtifacts,
  getManualActions,
  type BaselinePlan,
  type BaselinePlanResource,
  type BaselineProviderId,
  type DryRunPlan,
  type GeneratedArtifact,
  type ManualAction,
} from './generate.js';
export {
  getBlueprintDecisions,
  isRuntimeProviderId,
  qualityChecksFor,
  RUNTIME_PROVIDER_MAX_LENGTH,
  type BlueprintDecision,
} from './decisions.js';
export type { BlueprintAnswers, ProductBlueprint } from './index.js';
