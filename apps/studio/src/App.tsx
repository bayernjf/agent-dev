import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, ArrowRight, CheckCircle2, CircleDot, FolderKanban, KeyRound, PlugZap, RefreshCw, Settings2, ShieldCheck, Sparkles,
} from 'lucide-react';
import { getBlueprintDecisions, type BaselinePlan, type BlueprintAnswers, type DryRunPlan, type ProductBlueprint } from '@agent-dev/blueprint';
import type { AccountDiscoveryReport, ConnectorPreflightReport } from '@agent-dev/policy';

type Project = {
  id: string;
  name: string;
  productType: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectDetail = Project & { blueprint: ProductBlueprint };
type ActivityEntry = { id: string; text: string; time: string };
type BaselineApproval = { projectId: string; blueprintRevision: number; status: 'approved'; approvedBy: string; approvedAt: string };
type ApplyStep = { id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed'; detail?: string };
type ApplyRun = { id: string; projectId: string; blueprintRevision: number; status: 'queued' | 'running' | 'completed' | 'failed'; attempts: number; recoveryIndex: number; workspacePath: string; steps: ApplyStep[]; createdAt: string; updatedAt: string };
type DependencyReadiness = { status: 'not-applied' | 'missing-dependencies' | 'ready'; workspacePath: string | null; packageLockPresent: boolean; nodeModulesPresent: boolean; qualityCommandPresent: boolean; nextAction: string };
type QualityGateResult = { status: 'passed' | 'failed'; command: string; exitCode: number; output: string; completedAt: string };
type DependencyInstallResult = { status: 'installed' | 'failed'; exitCode: number; output: string; completedAt: string };
type FeatureTask = { id: string; blueprintRevision: number; title: string; objective: string; acceptanceCriteria: string[]; status: 'draft' | 'approved'; approvedBy?: string; approvedAt?: string };
type RuntimeAttempt = { attempt: number; status: 'running' | 'completed' | 'failed'; startedAt: string; completedAt?: string; result?: { exitCode: number | null; signal: string | null; timedOut: boolean; output: string } };
type RuntimeRun = { id: string; status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled'; taskId: string; blueprintRevision: number; agentId: string; attempts: number; history: RuntimeAttempt[]; plan: { mode: 'dry-run' | 'execute'; executionAllowed: boolean; noExternalChanges: boolean; command: string[] }; result?: { exitCode: number | null; signal: string | null; timedOut: boolean; output: string } };
type GitEvidence = { branch: string; head: string; status: string; diffStat: string };
type PrEvidence = { url: string; checks: string[]; recordedAt: string };
type PreviewEvidence = { apiUrl: string; webUrl: string; smokeTest: string; recordedAt: string };
type AcceptanceRecord = { status: 'blocked' | 'ready' | 'approved'; summary: string; criteriaConfirmed: boolean; qualityStatus: 'passed' | 'failed' | 'missing'; approvedBy?: string; approvedAt?: string };
type ProviderPlan = { providerId: string; idempotencyKey: string; noExternalChanges: true; resources: { spec: { id: string; kind: string; owner: string }; action: 'create' | 'update' | 'noop'; reason: string }[] };
type ProviderVerification = { providerId: string; verified: boolean; missing: string[]; mismatched: string[] };
type AgentDescriptor = { id: string; name: string; source: 'built-in' | 'custom'; launchCommand: string; detected: boolean; version: string | null; detail: string; capabilities: string[] };
type AgentCapabilityProbe = { agentId: string; nonInteractive: boolean; nonInteractiveFlags: string[]; workspaceWrite: boolean; helpAvailable: boolean; adapterStatus: 'verified' | 'candidate' | 'unsupported' };
type CredentialMeta = { version: 1; updatedAt: string; keys: string[] };
type ProjectResources = { version: number; projectName: string; projectId: string; blueprintRevision: number; updatedAt: string; providers: Record<string, Record<string, unknown>> } | null;
type CredentialVerifyResult = { providerId: string; status: 'valid' | 'invalid' | 'not_set'; detail: string };
type PreviewStep = { id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; detail?: string };
type PreviewDeploymentResult = { status: 'completed' | 'failed' | 'cancelled'; steps: PreviewStep[]; apiBaseUrl?: string; pagesUrl?: string; pagesUrlSource?: 'cli-output' | 'derived-fallback'; corsOrigin?: string; evidence?: Record<string, string>; cleanupRequired?: { vercel?: string; cloudflare?: string } };
type WorkspaceVerification = { usable: boolean; workspaceMissing: boolean; missing: string[]; staleConfig: string[]; reason?: string };
type ReleaseStep = { id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed'; detail?: string; startedAt?: string; completedAt?: string };
type ReleaseRun = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; attempts: number; approvedBy: string; approvalSummary: string; steps: ReleaseStep[]; createdAt: string; updatedAt: string };
type ReleaseEvidence = { projectName: string; apiBaseUrl: string; webUrl: string; corsOrigin: string; approvedBy: string; approvalSummary: string; observations: Record<string, unknown>; recordedAt: string };
type ReleaseSource = { repository: string; branch: string; acceptedCommit: string; checkoutPath: string };
type ReleasePlan = { steps: ReleaseStep[]; idempotencyKey: string; corsOrigin: string; productionApproval: string; state: string; workspace: WorkspaceVerification; releaseRun: ReleaseRun | null; source: ReleaseSource | null; sourceReason?: string };

const PROVIDER_FIELDS = [
  { key: 'GITHUB_TOKEN', label: 'GitHub Token', tutorial: 'https://github.com/settings/tokens', hint: 'Generate a classic token with repo and workflow scopes.', providerId: 'github' },
  { key: 'VERCEL_TOKEN', label: 'Vercel Token', tutorial: 'https://vercel.com/account/tokens', hint: 'Create a token with Full Account scope.', providerId: 'vercel' },
  { key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare API Token', tutorial: 'https://dash.cloudflare.com/profile/api-tokens', hint: 'Use the Edit Cloudflare Workers template.', providerId: 'cloudflare' },
  { key: 'SUPABASE_ACCESS_TOKEN', label: 'Supabase Access Token', tutorial: 'https://supabase.com/dashboard/account/tokens', hint: 'Generate a new access token.', providerId: 'supabase' },
] as const;

const APPROVER_STORAGE_KEY = 'agent-dev.approver';

const defaultAnswers: BlueprintAnswers = {
  mode: 'beginner',
  productIntent: '',
  dataSensitivity: 'standard',
  previewStrategy: 'per-pull-request',
  analyticsProviders: [],
  customInstructions: '',
  githubOwner: '',
  vercelTeam: '',
  cloudflareAccount: '',
  supabaseOrganization: '',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function answersFromBlueprint(blueprint: ProductBlueprint): BlueprintAnswers {
  return {
    mode: blueprint.metadata.mode,
    productIntent: blueprint.metadata.productIntent,
    dataSensitivity: blueprint.spec.product.dataSensitivity,
    previewStrategy: blueprint.spec.deployment.previewStrategy,
    analyticsProviders: blueprint.spec.analytics.providers,
    customInstructions: blueprint.metadata.customInstructions,
    githubOwner: blueprint.spec.sourceControl.owner,
    vercelTeam: blueprint.spec.deployment.api.team,
    cloudflareAccount: blueprint.spec.deployment.web.account,
    supabaseOrganization: blueprint.spec.data.organization,
  };
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [dryRun, setDryRun] = useState<DryRunPlan | null>(null);
  const [baselinePlan, setBaselinePlan] = useState<BaselinePlan | null>(null);
  const [baselineApproval, setBaselineApproval] = useState<BaselineApproval | null>(null);
  const [applyRun, setApplyRun] = useState<ApplyRun | null>(null);
  const [dependencyReadiness, setDependencyReadiness] = useState<DependencyReadiness | null>(null);
  const [qualityGateResult, setQualityGateResult] = useState<QualityGateResult | null>(null);
  const [featureTask, setFeatureTask] = useState<FeatureTask | null>(null);
  const [runtimeRun, setRuntimeRun] = useState<RuntimeRun | null>(null);
  const [gitEvidence, setGitEvidence] = useState<GitEvidence | null>(null);
  const [acceptance, setAcceptance] = useState<AcceptanceRecord | null>(null);
  const [providerPlans, setProviderPlans] = useState<ProviderPlan[]>([]);
  const [providerVerification, setProviderVerification] = useState<ProviderVerification[] | null>(null);
  const [providerReport, setProviderReport] = useState('');
  const [finalDeliveryReport, setFinalDeliveryReport] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<DryRunPlan['artifacts'][number]['id'] | null>(null);
  const [preflight, setPreflight] = useState<ConnectorPreflightReport | null>(null);
  const [accountDiscovery, setAccountDiscovery] = useState<AccountDiscoveryReport | null>(null);
  const [checkingPreflight, setCheckingPreflight] = useState(false);
  const [discoveringAccounts, setDiscoveringAccounts] = useState(false);
  const [approvingBaseline, setApprovingBaseline] = useState(false);
  const [applyingBaseline, setApplyingBaseline] = useState(false);
  const [installingDependencies, setInstallingDependencies] = useState(false);
  const [savingFeatureTask, setSavingFeatureTask] = useState(false);
  const [preparingRuntime, setPreparingRuntime] = useState(false);
  const [submittingAcceptance, setSubmittingAcceptance] = useState(false);
  const [applyingFakeProviders, setApplyingFakeProviders] = useState(false);
  const [verifyingProviders, setVerifyingProviders] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([{ id: 'local-ready', text: 'Local delivery control plane ready', time: 'Now' }]);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<BlueprintAnswers>(defaultAnswers);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [featureTitle, setFeatureTitle] = useState('');
  const [featureObjective, setFeatureObjective] = useState('');
  const [featureCriteria, setFeatureCriteria] = useState('');
  const [acceptanceSummary, setAcceptanceSummary] = useState('');
  const [criteriaConfirmed, setCriteriaConfirmed] = useState(false);
  const [prEvidence, setPrEvidence] = useState<PrEvidence | null>(null);
  const [previewEvidence, setPreviewEvidence] = useState<PreviewEvidence | null>(null);
  const [previewApiUrl, setPreviewApiUrl] = useState('');
  const [previewWebUrl, setPreviewWebUrl] = useState('');
  const [previewSmokeTest, setPreviewSmokeTest] = useState('');
  const [recordingDeliveryEvidence, setRecordingDeliveryEvidence] = useState(false);
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [customAgentName, setCustomAgentName] = useState('');
  const [customAgentCommand, setCustomAgentCommand] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentProbes, setAgentProbes] = useState<Record<string, AgentCapabilityProbe>>({});
  const [probingAgentId, setProbingAgentId] = useState<string | null>(null);
  const [credentialMeta, setCredentialMeta] = useState<CredentialMeta | null>(null);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [projectResources, setProjectResources] = useState<ProjectResources>(null);
  const [regeneratingEnv, setRegeneratingEnv] = useState(false);
  const [verifyResults, setVerifyResults] = useState<CredentialVerifyResult[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [guideMode, setGuideMode] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [newCustomKey, setNewCustomKey] = useState('');
  const [newCustomValue, setNewCustomValue] = useState('');
  const [supabaseInputs, setSupabaseInputs] = useState<{ SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }>({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  const [previewBranch, setPreviewBranch] = useState('preview');
  const [previewResult, setPreviewResult] = useState<PreviewDeploymentResult | null>(null);
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | null>(null);
  const [releaseRun, setReleaseRun] = useState<ReleaseRun | null>(null);
  const [releaseEvidence, setReleaseEvidence] = useState<ReleaseEvidence | null>(null);
  // Every human gate records the same name: an approval nobody is named on cannot be traced back to
  // a person, and two conventions on one chain make the question "who approved this?" unanswerable.
  const [approver, setApprover] = useState(() => localStorage.getItem(APPROVER_STORAGE_KEY) ?? '');
  const [releaseSummary, setReleaseSummary] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [recoveringWorkspace, setRecoveringWorkspace] = useState(false);
  const [deployingPreview, setDeployingPreview] = useState(false);

  const decisions = useMemo(() => selected ? getBlueprintDecisions(selected.blueprint) : [], [selected]);
  const selectedArtifact = useMemo(
    () => dryRun?.artifacts.find(artifact => artifact.id === selectedArtifactId) ?? null,
    [dryRun, selectedArtifactId],
  );

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('The local daemon is unavailable.');
      const payload = await response.json() as { projects: Project[] };
      setProjects(payload.projects);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load projects.');
    } finally {
      setLoading(false);
    }
  };

  const selectProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error('Unable to load this Blueprint.');
      const payload = await response.json() as { project: ProjectDetail };
      setSelected(payload.project);
      setName(payload.project.name);
      setAnswers(answersFromBlueprint(payload.project.blueprint));
      void loadDryRun(projectId);
      void loadBaselinePlan(projectId);
      void loadApplyRun(projectId);
      void loadDependencyReadiness(projectId);
      void loadQualityGate(projectId);
      void loadFeatureTask(projectId);
      void loadRuntimePlan(projectId);
      void loadAcceptance(projectId);
      void loadDeliveryEvidence(projectId);
      void loadFinalDeliveryReport(projectId);
      void loadProviderPlan(projectId);
      void loadProjectResources(projectId);
      void loadRelease(projectId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this Blueprint.');
    }
  };

  const loadBaselinePlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/baseline-plan`);
      if (!response.ok) throw new Error('Unable to prepare the baseline plan.');
      const payload = await response.json() as { plan: BaselinePlan; approval: BaselineApproval | null };
      setBaselinePlan(payload.plan);
      setBaselineApproval(payload.approval);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the baseline plan.');
    }
  };

  const loadDryRun = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/dry-run`);
      if (!response.ok) throw new Error('Unable to prepare the delivery plan.');
      const payload = await response.json() as { plan: DryRunPlan };
      setDryRun(payload.plan);
      setSelectedArtifactId(current => current && payload.plan.artifacts.some(artifact => artifact.id === current)
        ? current
        : payload.plan.artifacts[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the delivery plan.');
    }
  };

  const loadApplyRun = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/apply`);
      if (!response.ok) throw new Error('Unable to load the local Apply run.');
      const payload = await response.json() as { run: ApplyRun | null };
      setApplyRun(payload.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the local Apply run.');
    }
  };

  const loadRelease = async (projectId: string) => {
    try {
      const [planResponse, stateResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/release/plan`),
        fetch(`/api/projects/${projectId}/release`),
      ]);
      // A 409 here is informative, not an error: it carries the reason the workspace is unusable.
      const plan = planResponse.status === 404 ? null : await planResponse.json() as ReleasePlan;
      setReleasePlan(plan && 'steps' in plan ? plan : null);
      if (stateResponse.ok) {
        const payload = await stateResponse.json() as { releaseRun: ReleaseRun | null; evidence: ReleaseEvidence | null };
        setReleaseRun(payload.releaseRun);
        setReleaseEvidence(payload.evidence);
      }
    } catch {
      setReleasePlan(null);
    }
  };

  const recordApprover = (): string => {
    const name = approver.trim();
    if (name) localStorage.setItem(APPROVER_STORAGE_KEY, name);
    return name;
  };

  const approverField = (id: string, prompt: string) => (
    <div className="approver-field">
      <label htmlFor={id}>{prompt}</label>
      <input id={id} value={approver} onChange={event => setApprover(event.target.value)} placeholder="e.g. Jiang Feng" maxLength={120} />
    </div>
  );

  const requestRelease = async () => {
    if (!selected || releaseBusy) return;
    setReleaseBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/release/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'REQUEST_RELEASE' }),
      });
      const payload = await response.json() as { state?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to request a release.');
      await selectProject(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to request a release.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const approveRelease = async () => {
    if (!selected || releaseBusy) return;
    const approvedBy = recordApprover();
    if (!approvedBy || releaseSummary.trim().length === 0) {
      setError('A production release needs the approver name and what is being released.');
      return;
    }
    if (!window.confirm(`Release ${selected.name} to production as ${approvedBy}?`)) return;
    setReleaseBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/release/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'APPROVE_RELEASE', approvedBy, summary: releaseSummary.trim() }),
      });
      const payload = await response.json() as { releaseRun?: ReleaseRun; evidence?: ReleaseEvidence; error?: string };
      if (payload.error) throw new Error(payload.error);
      if (payload.releaseRun) setReleaseRun(payload.releaseRun);
      if (payload.evidence) setReleaseEvidence(payload.evidence);
      setError(response.ok ? '' : 'The release failed. Review the step details, then retry the approved release.');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve the release.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const retryRelease = async () => {
    if (!selected || releaseBusy) return;
    setReleaseBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/release/retry`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RETRY_RELEASE' }),
      });
      const payload = await response.json() as { releaseRun?: ReleaseRun; evidence?: ReleaseEvidence; error?: string };
      if (payload.error) throw new Error(payload.error);
      if (payload.releaseRun) setReleaseRun(payload.releaseRun);
      if (payload.evidence) setReleaseEvidence(payload.evidence);
      setError(response.ok ? '' : 'The release failed again. Review the step details before retrying.');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to retry the release.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const recoverWorkspace = async () => {
    if (!selected || recoveringWorkspace) return;
    if (!window.confirm('Create a clean workspace? The current one stays on disk so its failure remains inspectable.')) return;
    setRecoveringWorkspace(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/apply/recover`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RECOVER_WORKSPACE' }),
      });
      const payload = await response.json() as { run?: ApplyRun; abandoned?: { workspacePath: string }; error?: string };
      if (!payload.run) throw new Error(payload.error ?? 'Unable to recover the workspace.');
      setApplyRun(payload.run);
      setPreviewResult(null);
      setError(response.ok ? '' : 'The recovery workspace also failed. Review the step details.');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to recover the workspace.');
    } finally {
      setRecoveringWorkspace(false);
    }
  };

  const loadDependencyReadiness = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/dependencies`);
      if (!response.ok) throw new Error('Unable to inspect template dependencies.');
      const payload = await response.json() as { readiness: DependencyReadiness };
      setDependencyReadiness(payload.readiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect template dependencies.');
    }
  };

  const loadQualityGate = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/quality-gate`);
      if (!response.ok) throw new Error('Unable to load the quality gate result.');
      const payload = await response.json() as { result: QualityGateResult | null };
      setQualityGateResult(payload.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the quality gate result.');
    }
  };

  const loadFeatureTask = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/feature-task`);
      if (!response.ok) throw new Error('Unable to load the feature task.');
      const payload = await response.json() as { task: FeatureTask | null };
      setFeatureTask(payload.task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the feature task.');
    }
  };

  const loadRuntimePlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/plan`);
      if (response.status === 409) { setRuntimeRun(null); return; }
      if (!response.ok) throw new Error('Unable to load the Runtime plan.');
      const payload = await response.json() as { run: RuntimeRun | null };
      setRuntimeRun(payload.run);
      if (payload.run) await loadGitEvidence(projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the Runtime plan.');
    }
  };

  const loadGitEvidence = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/evidence`);
      if (!response.ok) throw new Error('Unable to load Git evidence.');
      const payload = await response.json() as { evidence: GitEvidence };
      setGitEvidence(payload.evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Git evidence.');
    }
  };

  const loadAcceptance = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/acceptance`);
      if (!response.ok) throw new Error('Unable to load acceptance.');
      const payload = await response.json() as { acceptance: AcceptanceRecord | null };
      setAcceptance(payload.acceptance);
      if (payload.acceptance) { setAcceptanceSummary(payload.acceptance.summary); setCriteriaConfirmed(payload.acceptance.criteriaConfirmed); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load acceptance.');
    }
  };

  const loadFinalDeliveryReport = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/delivery-report`);
      if (!response.ok) throw new Error('Unable to load the final delivery report.');
      const payload = await response.json() as { report: string };
      setFinalDeliveryReport(payload.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the final delivery report.');
    }
  };

  const loadDeliveryEvidence = async (projectId: string) => {
    try {
      const [prResponse, previewResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/delivery/pr-evidence`),
        fetch(`/api/projects/${projectId}/delivery/preview-evidence`),
      ]);
      if (!prResponse.ok || !previewResponse.ok) throw new Error('Unable to load delivery evidence.');
      const prPayload = await prResponse.json() as { evidence: PrEvidence | null };
      const previewPayload = await previewResponse.json() as { evidence: PreviewEvidence | null };
      setPrEvidence(prPayload.evidence);
      setPreviewEvidence(previewPayload.evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load delivery evidence.');
    }
  };

  const openPullRequest = async () => {
    if (!selected || selected.state !== 'LOCAL_ACCEPTED') return;
    setRecordingDeliveryEvidence(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/delivery/pull-request`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'OPEN_PULL_REQUEST' }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to open the pull request.');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open the pull request.');
    } finally {
      setRecordingDeliveryEvidence(false);
    }
  };

  const recordPreviewEvidence = async () => {
    if (!selected || selected.state !== 'PR_OPEN' || !previewApiUrl.trim() || !previewWebUrl.trim() || !previewSmokeTest.trim()) return;
    setRecordingDeliveryEvidence(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/delivery/preview-evidence`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RECORD_PREVIEW_EVIDENCE', apiUrl: previewApiUrl.trim(), webUrl: previewWebUrl.trim(), smokeTest: previewSmokeTest.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to record Preview evidence.');
      setPreviewApiUrl(''); setPreviewWebUrl(''); setPreviewSmokeTest('');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to record Preview evidence.');
    } finally {
      setRecordingDeliveryEvidence(false);
    }
  };

  const loadProviderPlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/provider-plan`);
      if (!response.ok) throw new Error('Unable to load the provider simulation plan.');
      const payload = await response.json() as { plans: ProviderPlan[] };
      setProviderPlans(payload.plans);
      setProviderVerification(null);
      setProviderReport('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the provider simulation plan.');
    }
  };

  const loadAgents = async () => {
    setLoadingAgents(true);
    try {
      const response = await fetch('/api/runtime/catalog');
      if (!response.ok) throw new Error('Unable to load the Agent Catalog.');
      const payload = await response.json() as { agents: AgentDescriptor[] };
      setAgents(payload.agents);
      setSelectedAgentId(current => {
        if (current && payload.agents.some(agent => agent.id === current)) return current;
        const firstDetected = payload.agents.find(agent => agent.detected);
        return firstDetected?.id ?? payload.agents[0]?.id ?? null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the Agent Catalog.');
    } finally {
      setLoadingAgents(false);
    }
  };

  const probeAgent = async (agent: AgentDescriptor) => {
    if (!agent.detected || probingAgentId === agent.id) return;
    setSelectedAgentId(agent.id);
    setProbingAgentId(agent.id);
    try {
      const response = await fetch(`/api/runtime/probe/${encodeURIComponent(agent.id)}`);
      const payload = await response.json() as { probe?: Omit<AgentCapabilityProbe, 'adapterStatus'>; adapterStatus?: AgentCapabilityProbe['adapterStatus']; error?: string };
      if (!response.ok || !payload.probe) throw new Error(payload.error ?? 'Unable to probe Agent capabilities.');
      setAgentProbes(current => ({ ...current, [agent.id]: { ...payload.probe!, adapterStatus: payload.adapterStatus ?? 'unsupported' } }));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to probe Agent capabilities.');
    } finally {
      setProbingAgentId(null);
    }
  };

  const addCustomAgent = async () => {
    if (customAgentName.trim().length < 1 || customAgentCommand.trim().length < 1) {
      setError('Custom Agent requires both a name and a launch command.');
      return;
    }
    setSavingAgent(true);
    try {
      const response = await fetch('/api/runtime/catalog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: customAgentName.trim(), launchCommand: customAgentCommand.trim() }),
      });
      const payload = await response.json() as { agent?: AgentDescriptor; error?: string };
      if (!response.ok || !payload.agent) throw new Error(payload.error ?? 'Unable to register the custom Agent.');
      await loadAgents();
      setSelectedAgentId(payload.agent.id);
      setCustomAgentName('');
      setCustomAgentCommand('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to register the custom Agent.');
    } finally {
      setSavingAgent(false);
    }
  };

  const loadCredentials = async () => {
    try {
      const response = await fetch('/api/credentials');
      if (!response.ok) throw new Error('Unable to load credential status.');
      const payload = await response.json() as { meta: CredentialMeta };
      setCredentialMeta(payload.meta);
      if (payload.meta.keys.length === 0 && !guideMode) setGuideMode(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load credential status.');
    }
  };

  const verifyAllCredentials = async () => {
    setVerifying(true);
    try {
      const response = await fetch('/api/credentials/verify', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to verify credentials.');
      const payload = await response.json() as { results: CredentialVerifyResult[] };
      setVerifyResults(payload.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to verify credentials.');
    } finally {
      setVerifying(false);
    }
  };

  const addCustomKey = async () => {
    const key = newCustomKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const value = newCustomValue.trim();
    if (!key || !value) { setError('Both key name and value are required for custom API keys.'); return; }
    if (credentialMeta?.keys.includes(key)) { setError(`Key "${key}" already exists.`); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? 'Unable to save custom key.');
      setCredentialMeta(payload.meta ?? null);
      setNewCustomKey('');
      setNewCustomValue('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save custom key.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const saveSupabaseManual = async () => {
    const entries = Object.entries(supabaseInputs).filter(([, v]) => (v as string).trim().length > 0);
    if (entries.length === 0) { setError('Fill in at least the Supabase URL before saving.'); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]))),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? 'Unable to save Supabase credentials.');
      setCredentialMeta(payload.meta ?? null);
      setSupabaseInputs({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save Supabase credentials.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const saveCredentialValues = async () => {
    const entries = Object.entries(credentialInputs).filter(([, value]) => value.trim().length > 0);
    if (entries.length === 0) { setError('Fill in at least one token before saving.'); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]))),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? 'Unable to save credentials.');
      setCredentialMeta(payload.meta ?? null);
      setCredentialInputs({});
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save credentials.');
    } finally {
      setSavingCredentials(false);
    }
  };

  const deleteCredential = async (key: string) => {
    if (!window.confirm(`Delete ${key} from the local credential file?`)) return;
    try {
      const response = await fetch(`/api/credentials/${key}`, { method: 'DELETE' });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? 'Unable to delete credential.');
      setCredentialMeta(payload.meta ?? null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete credential.');
    }
  };

  const loadProjectResources = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/resources`);
      if (!response.ok) throw new Error('Unable to load project resources.');
      const payload = await response.json() as { resources: ProjectResources };
      setProjectResources(payload.resources);
    } catch {
      setProjectResources(null);
    }
  };

  const regenerateEnv = async () => {
    if (!selected) return;
    setRegeneratingEnv(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/env/regenerate`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to regenerate .env.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to regenerate .env.');
    } finally {
      setRegeneratingEnv(false);
    }
  };

  const startNewProject = () => {
    setSelected(null);
    setDryRun(null);
    setBaselinePlan(null);
    setBaselineApproval(null);
    setApplyRun(null);
    setDependencyReadiness(null);
    setQualityGateResult(null);
    setFeatureTask(null);
    setRuntimeRun(null);
    setGitEvidence(null);
    setAcceptance(null);
    setProviderPlans([]);
    setProviderVerification(null);
    setProviderReport('');
    setFinalDeliveryReport('');
    setSelectedArtifactId(null);
    setName('');
    setAnswers(defaultAnswers);
    setError('');
    setFeatureTitle('');
    setFeatureObjective('');
    setFeatureCriteria('');
    setAcceptanceSummary('');
    setCriteriaConfirmed(false);
  };

  const runPreflight = async () => {
    setCheckingPreflight(true);
    try {
      const response = await fetch('/api/connectors/preflight');
      if (!response.ok) throw new Error('Unable to run local connector preflight.');
      setPreflight(await response.json() as ConnectorPreflightReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run local connector preflight.');
    } finally {
      setCheckingPreflight(false);
    }
  };

  const discoverAccounts = async () => {
    setDiscoveringAccounts(true);
    try {
      const response = await fetch('/api/connectors/discovery');
      if (!response.ok) throw new Error('Unable to discover local connector identities.');
      setAccountDiscovery(await response.json() as AccountDiscoveryReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to discover local connector identities.');
    } finally {
      setDiscoveringAccounts(false);
    }
  };

  const approveBaseline = async () => {
    if (!selected || !baselinePlan?.readyForApproval || baselineApproval) return;
    const approvedBy = recordApprover();
    if (!approvedBy) {
      setError('Record who approves this baseline: an approval without a name cannot be traced to a person.');
      return;
    }
    const confirmed = window.confirm(`Record approval for this baseline as ${approvedBy}? No remote resource will be created.`);
    if (!confirmed) return;
    setApprovingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/baseline-plan/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: baselinePlan.blueprintRevision, confirmation: 'APPROVE_BASELINE', approvedBy }),
      });
      const payload = await response.json() as { approval?: BaselineApproval; error?: string };
      if (!response.ok || !payload.approval) throw new Error(payload.error ?? 'Unable to approve the baseline.');
      setBaselineApproval(payload.approval);
      setActivity(current => [{ id: crypto.randomUUID(), text: 'Baseline approval recorded', time: 'Now' }, ...current].slice(0, 5));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve the baseline.');
    } finally {
      setApprovingBaseline(false);
    }
  };

  const applyBaseline = async () => {
    if (!selected || !baselinePlan?.readyForApproval || !baselineApproval || applyingBaseline) return;
    const confirmed = window.confirm('Run the local Apply Simulator? It writes only inside .agent-dev and makes no external changes.');
    if (!confirmed) return;
    setApplyingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: baselinePlan.blueprintRevision, confirmation: 'APPLY_BASELINE' }),
      });
      const payload = await response.json() as { run?: ApplyRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Unable to run local Apply.');
      setApplyRun(payload.run);
      void loadDependencyReadiness(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run local Apply.');
    } finally {
      setApplyingBaseline(false);
    }
  };

  const retryApply = async () => {
    if (!selected || !applyRun || applyRun.status !== 'failed' || applyRun.attempts >= 3 || applyingBaseline) return;
    setApplyingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/apply/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RETRY_APPLY' }),
      });
      const payload = await response.json() as { run?: ApplyRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Unable to retry local Apply.');
      setApplyRun(payload.run);
      void loadDependencyReadiness(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to retry local Apply.');
    } finally {
      setApplyingBaseline(false);
    }
  };

  const runQualityGate = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || dependencyReadiness?.status !== 'ready') return;
    setApplyingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/quality-gate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, confirmation: 'RUN_QUALITY_GATE' }),
      });
      const payload = await response.json() as { result?: QualityGateResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? 'Unable to run the quality gate.');
      setQualityGateResult(payload.result);
      setError(response.ok ? '' : `Quality Gate failed with exit code ${payload.result.exitCode}.`);
      await loadDependencyReadiness(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run the quality gate.');
    } finally {
      setApplyingBaseline(false);
    }
  };

  const installDependencies = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || dependencyReadiness?.status !== 'missing-dependencies' || installingDependencies) return;
    if (!window.confirm('Run npm install in the isolated Agent-Dev workspace? This may access the npm registry and writes only that workspace.')) return;
    setInstallingDependencies(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/dependencies/install`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, confirmation: 'INSTALL_DEPENDENCIES' }),
      });
      const payload = await response.json() as { result?: DependencyInstallResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? 'Unable to install dependencies.');
      await loadDependencyReadiness(selected.id);
      setError(response.ok ? '' : `Dependency installation failed with exit code ${payload.result.exitCode}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to install dependencies.');
    } finally {
      setInstallingDependencies(false);
    }
  };

  const deployPreview = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || deployingPreview) return;
    if (!/^[a-z0-9-]+$/.test(previewBranch)) {
      setError('Preview branch must contain only lowercase letters, digits, and hyphens.');
      return;
    }
    setDeployingPreview(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${selected.id}/preview/deploy`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DEPLOY_PREVIEW', previewBranch }),
      });
      const payload = await response.json() as { result?: PreviewDeploymentResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? 'Unable to deploy preview.');
      setPreviewResult(payload.result);
      if (payload.result.status !== 'completed') setError(`Preview deployment ${payload.result.status}. Check step details.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to deploy preview.');
    } finally {
      setDeployingPreview(false);
    }
  };

  const cleanupPreview = async () => {
    if (!selected || !previewResult?.cleanupRequired) return;
    if (!window.confirm('Delete the preview projects from Vercel and Cloudflare?')) return;
    setDeployingPreview(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/preview/cleanup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'CLEANUP_PREVIEW', vercelProject: previewResult.cleanupRequired.vercel, cloudflareProject: previewResult.cleanupRequired.cloudflare }),
      });
      const payload = await response.json() as { cleanup?: { vercel: boolean; cloudflare: boolean; errors: { provider: string; project: string; detail: string }[] }; error?: string };
      if (!payload.cleanup) throw new Error(payload.error ?? 'Unable to cleanup preview.');
      setPreviewResult(null);
      if (payload.cleanup.errors.length > 0) setError(`Cleanup partial: ${payload.cleanup.errors.map(e => e.provider).join(', ')} failed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to cleanup preview.');
    } finally {
      setDeployingPreview(false);
    }
  };

  const createFeatureTask = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || savingFeatureTask) return;
    const acceptanceCriteria = featureCriteria.split('\n').map(value => value.trim()).filter(Boolean);
    if (featureTitle.trim().length < 3 || featureObjective.trim().length < 10 || acceptanceCriteria.length === 0) {
      setError('Provide a task title of at least 3 characters, an objective of at least 10 characters, and at least one acceptance criterion.');
      return;
    }
    setSavingFeatureTask(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/feature-task`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, title: featureTitle, objective: featureObjective, acceptanceCriteria }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? 'Unable to create the feature task.');
      setFeatureTask(payload.task);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the feature task.');
    } finally {
      setSavingFeatureTask(false);
    }
  };

  const approveFeatureTask = async () => {
    if (!selected || !featureTask || featureTask.status !== 'draft' || savingFeatureTask) return;
    const approvedBy = recordApprover();
    if (!approvedBy) {
      setError('Record who approves this task: an approval without a name cannot be traced to a person.');
      return;
    }
    if (!window.confirm(`Approve this task and its acceptance criteria for Agent execution as ${approvedBy}?`)) return;
    setSavingFeatureTask(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/feature-task/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: featureTask.blueprintRevision, confirmation: 'APPROVE_FEATURE_TASK', approvedBy }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? 'Unable to approve the feature task.');
      setFeatureTask(payload.task);
      void loadRuntimePlan(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve the feature task.');
    } finally {
      setSavingFeatureTask(false);
    }
  };

  const prepareRuntime = async () => {
    if (!selected || !featureTask || featureTask.status !== 'approved' || preparingRuntime) return;
    if (!window.confirm('Prepare a guarded Runtime dry-run? No Codex process will start and no files will be changed.')) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'PREPARE_RUNTIME_RUN', agentId: selectedAgentId }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Unable to prepare the Runtime run.');
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the Runtime run.');
    } finally {
      setPreparingRuntime(false);
    }
  };

  const cancelRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'planned' || preparingRuntime) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'CANCEL_RUNTIME_RUN' }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'Unable to cancel the Runtime run.');
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to cancel the Runtime run.');
    } finally {
      setPreparingRuntime(false);
    }
  };

  const executeRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'planned' || preparingRuntime) return;
    if (!window.confirm('Start Codex in the approved workspace? It may modify only that workspace and will not deploy or access production resources.')) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/execute`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'EXECUTE_RUNTIME_RUN' }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!payload.run) throw new Error(payload.error ?? 'Unable to execute the Runtime run.');
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError(response.ok ? '' : `Codex execution failed with exit code ${payload.run.result?.exitCode ?? 'none'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to execute the Runtime run.');
    } finally {
      setPreparingRuntime(false);
    }
  };

  const retryRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'failed' || preparingRuntime) return;
    if (!window.confirm('Retry Codex in the same approved workspace? The previous failed attempt will be preserved.')) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/retry`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'RETRY_RUNTIME_RUN' }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!payload.run) throw new Error(payload.error ?? 'Unable to retry the Runtime run.');
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError(response.ok ? '' : `Codex retry failed with exit code ${payload.run.result?.exitCode ?? 'none'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to retry the Runtime run.');
    } finally {
      setPreparingRuntime(false);
    }
  };

  const submitAcceptance = async () => {
    if (!selected || !featureTask || featureTask.status !== 'approved' || !runtimeRun || submittingAcceptance || acceptance?.status === 'approved') return;
    if (acceptanceSummary.trim().length < 10) { setError('Write an acceptance summary of at least 10 characters before submitting.'); return; }
    setSubmittingAcceptance(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/acceptance`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: acceptanceSummary, criteriaConfirmed }),
      });
      const payload = await response.json() as { acceptance?: AcceptanceRecord; error?: string };
      if (!payload.acceptance) throw new Error(payload.error ?? 'Unable to submit acceptance.');
      setAcceptance(payload.acceptance);
      await loadFinalDeliveryReport(selected.id);
      setError(response.ok ? '' : 'Acceptance is blocked. Review the evidence before approval.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit acceptance.');
    } finally {
      setSubmittingAcceptance(false);
    }
  };

  const approveDelivery = async () => {
    if (!selected || !acceptance || acceptance.status !== 'ready' || submittingAcceptance) return;
    const approvedBy = recordApprover();
    if (!approvedBy) {
      setError('Record who accepts this delivery: an acceptance without a name cannot be traced to a person.');
      return;
    }
    if (!window.confirm(`Approve this delivery evidence as ${approvedBy}? This does not deploy production resources.`)) return;
    setSubmittingAcceptance(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/acceptance/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'APPROVE_DELIVERY', approvedBy }),
      });
      const payload = await response.json() as { acceptance?: AcceptanceRecord; error?: string };
      if (!response.ok || !payload.acceptance) throw new Error(payload.error ?? 'Unable to approve delivery.');
      setAcceptance(payload.acceptance);
      await loadFinalDeliveryReport(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve delivery.');
    } finally {
      setSubmittingAcceptance(false);
    }
  };

  const applyFakeProviders = async () => {
    if (!selected || !baselineApproval || applyingFakeProviders) return;
    const confirmed = window.confirm('Run the Fake Provider simulation? It changes only in-memory simulation state and creates no cloud resources.');
    if (!confirmed) return;
    setApplyingFakeProviders(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/provider-plan/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'APPLY_FAKE_PROVIDERS' }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to apply the provider simulation.');
      await verifyProviders();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to apply the provider simulation.');
    } finally {
      setApplyingFakeProviders(false);
    }
  };

  const verifyProviders = async () => {
    if (!selected || verifyingProviders) return;
    setVerifyingProviders(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/provider-plan/verify`);
      if (!response.ok) throw new Error('Unable to verify provider simulation state.');
      const payload = await response.json() as { verification: ProviderVerification[]; deliveryReport: string; unifiedDeliveryReport: string };
      setProviderVerification(payload.verification);
      setProviderReport(payload.unifiedDeliveryReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to verify provider simulation state.');
    } finally {
      setVerifyingProviders(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    void loadAgents();
    void loadCredentials();
    const source = new EventSource('/events');
    const onEvent = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { type: string; projectId: string; projectName: string; occurredAt: string };
      setActivity(current => [
        { id: crypto.randomUUID(), text: `${payload.type === 'blueprint.revised' ? 'Blueprint revised' : payload.type === 'baseline.approved' ? 'Baseline approved' : payload.type === 'apply.completed' ? 'Local Apply completed' : payload.type === 'apply.failed' ? 'Local Apply failed' : 'Project created'}: ${payload.projectName}`, time: formatDate(payload.occurredAt) },
        ...current,
      ].slice(0, 5));
      void loadProjects();
      if (selected?.id === payload.projectId) void selectProject(payload.projectId);
    };
    source.addEventListener('project.created', onEvent);
    source.addEventListener('blueprint.revised', onEvent);
    source.addEventListener('baseline.approved', onEvent);
    source.addEventListener('apply.completed', onEvent);
    source.addEventListener('apply.failed', onEvent);
    return () => source.close();
  }, [selected?.id]);

  const setAnswer = <Key extends keyof BlueprintAnswers>(key: Key, value: BlueprintAnswers[Key]) => {
    setAnswers(current => ({ ...current, [key]: value }));
  };

  const toggleAnalytics = (provider: 'ga4' | 'clarity') => {
    setAnswers(current => ({
      ...current,
      analyticsProviders: current.analyticsProviders.includes(provider)
        ? current.analyticsProviders.filter(item => item !== provider)
        : [...current.analyticsProviders, provider],
    }));
  };

  async function saveBlueprint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Use a project name with at least two characters.');
      return;
    }
    setSaving(true);
    try {
      const url = selected ? `/api/projects/${selected.id}/blueprint` : '/api/projects';
      const response = await fetch(url, {
        method: selected ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selected ? { answers } : { name: name.trim(), answers }),
      });
      const payload = await response.json() as { project?: ProjectDetail; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? 'Unable to save the Blueprint.');
      setSelected(payload.project);
      setName(payload.project.name);
      setAnswers(answersFromBlueprint(payload.project.blueprint));
      await loadDryRun(payload.project.id);
      await loadBaselinePlan(payload.project.id);
      await loadApplyRun(payload.project.id);
      await loadProviderPlan(payload.project.id);
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the Blueprint.');
    } finally {
      setSaving(false);
    }
  }

  const isProfessional = answers.mode === 'professional';

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><img className="brand-mark" src="/favicon.svg" alt="" width={22} height={22} /><span>Agent-Dev</span></div>
        <nav aria-label="Studio navigation">
          <a className="nav-item active" href="#projects"><FolderKanban size={18} aria-hidden="true" />Projects</a>
          <a className="nav-item" href="#decisions"><ShieldCheck size={18} aria-hidden="true" />Decisions</a>
          <a className="nav-item" href="#connections"><PlugZap size={18} aria-hidden="true" />Connections</a>
          <a className="nav-item" href="#credentials"><KeyRound size={18} aria-hidden="true" />Credentials</a>
          <a className="nav-item" href="#agents"><CircleDot size={18} aria-hidden="true" />Agents</a>
          <a className="nav-item" href="#activity"><Activity size={18} aria-hidden="true" />Activity</a>
          <a className="nav-item" href="#standards"><Settings2 size={18} aria-hidden="true" />Standards</a>
        </nav>
        <div className="sidebar-note"><CircleDot size={14} aria-hidden="true" />Local daemon connected</div>
      </aside>

      <section className="workspace" id="projects">
        <header className="topbar">
          <div><p className="eyebrow">Delivery Control Plane</p><h1>Blueprint Studio</h1></div>
          <button className="icon-button" type="button" onClick={() => void loadProjects()} aria-label="Refresh projects" title="Refresh projects"><RefreshCw size={18} /></button>
        </header>

        <div className="studio-grid">
          <section className="project-area" aria-label="Projects">
            <div className="section-heading"><div><h2>Projects</h2><p>Each Blueprint is the durable source of truth for a delivery run.</p></div><button className="quiet-button" type="button" onClick={startNewProject}>New Blueprint</button></div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="project-table" role="table" aria-label="Projects">
              <div className="table-head" role="row"><span>Project</span><span>Mode</span><span>Delivery state</span><span>Updated</span></div>
              {loading ? <p className="empty-state">Loading projects...</p> : projects.length === 0 ? <p className="empty-state">No projects yet. Start a Blueprint to establish a delivery baseline.</p> : projects.map(project => (
                <button className={`table-row project-row ${selected?.id === project.id ? 'selected' : ''}`} role="row" type="button" onClick={() => void selectProject(project.id)} key={project.id}>
                  <strong>{project.name}</strong><span>{project.productType}</span><span className="state">{project.state.replaceAll('_', ' ')}</span><time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
                </button>
              ))}
            </div>

            {selected && <section className="decision-section" id="decisions">
              <div className="section-heading"><div><p className="eyebrow">Revision {selected.blueprint.metadata.revision}</p><h2>Delivery decisions</h2></div><span className="mode-tag">{selected.blueprint.metadata.mode}</span></div>
              <div className="decision-list">{decisions.map(decision => <article className="decision" key={decision.id}>
                <div><h3>{decision.title}</h3><p>{decision.value}</p><small>{decision.reason}</small></div><span className={`decision-mode ${decision.mode}`}>{decision.mode === 'auto' ? 'Automatic' : decision.mode === 'ask' ? 'Needs approval' : 'Manual step'}</span>
              </article>)}</div>
            </section>}

            {selected && dryRun && <section className="plan-section" id="standards">
              <div className="section-heading"><div><p className="eyebrow">Dry run · Revision {dryRun.blueprintRevision}</p><h2>Delivery plan</h2><p>{dryRun.summary}</p></div><span className="dry-run-tag">No external writes</span></div>
              <div className="plan-grid">
                <article className="plan-card"><h3>Prepared automatically</h3><ol>{dryRun.automaticPreparation.map(step => <li key={step}>{step}</li>)}</ol></article>
                <article className="plan-card"><h3>Required from you</h3><ol>{dryRun.manualActions.map(action => <li key={action.id}><strong>{action.title}</strong><span>{action.reason}</span><small>Verify: {action.verification}</small></li>)}</ol></article>
              </div>
              <div className="artifact-heading"><div><h3>Generated delivery package</h3><p>Preview only. Files are not yet written to a product repository.</p></div><button className="icon-button" type="button" onClick={() => void loadDryRun(selected.id)} aria-label="Refresh delivery plan" title="Refresh delivery plan"><RefreshCw size={17} /></button></div>
              <div className="artifact-list">{dryRun.artifacts.map(artifact => <button className={`artifact-button ${selectedArtifact?.id === artifact.id ? 'selected' : ''}`} type="button" key={artifact.id} onClick={() => setSelectedArtifactId(artifact.id)}><strong>{artifact.title}</strong><span>{artifact.path}</span></button>)}</div>
              {selectedArtifact && <article className="artifact-preview"><div><h3>{selectedArtifact.title}</h3><p>{selectedArtifact.path}</p></div><pre>{selectedArtifact.content}</pre></article>}
            </section>}

            {selected?.state === 'LOCAL_ACCEPTED' && <section className="evidence-section"><div className="section-heading"><div><p className="eyebrow">Delivery evidence</p><h2>Open Pull Request</h2><p>Agent-Dev pushes the accepted commit to the recorded repository, opens the Pull Request against the integration branch, and records the evidence itself.</p></div><span className="dry-run-tag">LOCAL_ACCEPTED</span></div><div className="evidence-form"><button className="primary-button" type="button" onClick={() => void openPullRequest()} disabled={recordingDeliveryEvidence}>{recordingDeliveryEvidence ? 'Opening...' : 'Push and open Pull Request'}<ArrowRight size={15} aria-hidden="true" /></button></div></section>}
            {selected?.state === 'PR_OPEN' && <section className="evidence-section"><div className="section-heading"><div><p className="eyebrow">Delivery evidence</p><h2>Record Dual Preview</h2><p>Supply both public URLs and the smoke-test result before Preview is marked ready.</p></div><span className="dry-run-tag">PR_OPEN</span></div><div className="evidence-form"><label htmlFor="preview-api-url">API Preview URL</label><input id="preview-api-url" type="url" value={previewApiUrl} onChange={event => setPreviewApiUrl(event.target.value)} placeholder="https://api-preview.vercel.app" /><label htmlFor="preview-web-url">Web Preview URL</label><input id="preview-web-url" type="url" value={previewWebUrl} onChange={event => setPreviewWebUrl(event.target.value)} placeholder="https://preview.pages.dev" /><label htmlFor="preview-smoke-test">Smoke-test result</label><textarea id="preview-smoke-test" value={previewSmokeTest} onChange={event => setPreviewSmokeTest(event.target.value)} placeholder="Page loaded and API health returned 200 with exact CORS." /><button className="primary-button" type="button" onClick={() => void recordPreviewEvidence()} disabled={recordingDeliveryEvidence || !previewApiUrl.trim() || !previewWebUrl.trim() || !previewSmokeTest.trim()}>{recordingDeliveryEvidence ? 'Recording...' : 'Record Preview evidence'}<ArrowRight size={15} aria-hidden="true" /></button></div></section>}

            {(prEvidence || previewEvidence) && <section className="evidence-section evidence-records"><div className="section-heading"><div><p className="eyebrow">Recorded evidence</p><h2>Delivery evidence history</h2><p>These records were read from the isolated workspace and can be reviewed after a refresh.</p></div><CheckCircle2 size={18} aria-hidden="true" /></div>{prEvidence && <article className="evidence-record"><strong>Pull Request</strong><a href={prEvidence.url} target="_blank" rel="noreferrer">{prEvidence.url}</a><small>{prEvidence.checks.join(' · ')} · {formatDate(prEvidence.recordedAt)}</small></article>}{previewEvidence && <article className="evidence-record"><strong>Dual Preview</strong><span>API: {previewEvidence.apiUrl}</span><span>Web: {previewEvidence.webUrl}</span><small>{previewEvidence.smokeTest} · {formatDate(previewEvidence.recordedAt)}</small></article>}</section>}

            {selected && baselinePlan && <section className="baseline-section">
              <div className="section-heading"><div><p className="eyebrow">Resource plan · Revision {baselinePlan.blueprintRevision}</p><h2>Baseline resources</h2><p>{baselinePlan.summary}</p></div><span className={`baseline-tag ${baselineApproval ? 'approved' : baselinePlan.readyForApproval ? 'ready' : 'blocked'}`}>{baselineApproval ? 'Approved' : baselinePlan.readyForApproval ? 'Ready for approval' : 'Ownership required'}</span></div>
              <div className="baseline-list">{baselinePlan.resources.map(resource => <article className="baseline-resource" key={resource.id}>
                <div><h3>{resource.title}</h3><p>{resource.owner ?? 'Not selected'}</p><small>{resource.reason}</small></div><span className={`resource-status ${resource.status}`}>{resource.status === 'blocked' ? 'Blocked' : baselineApproval ? 'Approved' : 'Awaiting approval'}</span>
              </article>)}</div>
              {baselineApproval ? <div className="approval-record"><CheckCircle2 size={17} aria-hidden="true" /><div><strong>Baseline approval recorded</strong><small>Revision {baselineApproval.blueprintRevision} · {baselineApproval.approvedBy} · {formatDate(baselineApproval.approvedAt)}</small></div></div> : baselinePlan.readyForApproval ? <div className="approval-action"><p>This records intent only. It does not create remote resources or reveal secrets.</p>{approverField('baseline-approver', 'Who approves this baseline?')}<button className="primary-button" type="button" onClick={() => void approveBaseline()} disabled={approvingBaseline}>{approvingBaseline ? 'Recording approval...' : 'Approve baseline plan'}<ShieldCheck size={16} aria-hidden="true" /></button></div> : null}
              {baselineApproval && !applyRun && <div className="approval-action"><p>Run the local simulator to create the delivery package in the ignored `.agent-dev` workspace.</p><button className="primary-button" type="button" onClick={() => void applyBaseline()} disabled={applyingBaseline}>{applyingBaseline ? 'Applying locally...' : 'Run local Apply'}<ArrowRight size={16} aria-hidden="true" /></button></div>}
              {applyRun && <div className={`apply-run ${applyRun.status}`}><div className="apply-run-heading"><strong>Local Apply {applyRun.status}</strong><small>Attempt {applyRun.attempts} of 3 · {applyRun.workspacePath}</small></div><ol>{applyRun.steps.map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{step.status}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>{applyRun.status === 'failed' && applyRun.attempts < 3 && <button className="secondary-button retry-button" type="button" onClick={() => void retryApply()} disabled={applyingBaseline}>{applyingBaseline ? 'Retrying...' : 'Retry local Apply'}<RefreshCw size={15} aria-hidden="true" /></button>}{(applyRun.status === 'failed' || releasePlan?.workspace.usable === false) && <div className="workspace-recovery"><p>{releasePlan?.workspace.usable === false ? `This workspace is not usable: ${[...releasePlan.workspace.missing, ...releasePlan.workspace.staleConfig].join(', ') || releasePlan.workspace.reason}` : 'Retrying in place reuses whatever the failed run left behind.'}</p><button className="secondary-button" type="button" onClick={() => void recoverWorkspace()} disabled={recoveringWorkspace}>{recoveringWorkspace ? 'Recovering...' : 'Recover into a clean workspace'}<RefreshCw size={15} aria-hidden="true" /></button></div>}</div>}
              {applyRun?.status === 'completed' && dependencyReadiness && <div className={`quality-gate ${dependencyReadiness.status}`}><div><p className="eyebrow">Local quality gate</p><h3>{qualityGateResult ? `Last run: ${qualityGateResult.status}` : dependencyReadiness.status === 'ready' ? 'Ready to run' : 'Dependencies required'}</h3><p>{dependencyReadiness.nextAction}</p></div>{dependencyReadiness.status === 'missing-dependencies' && <button className="secondary-button" type="button" onClick={() => void installDependencies()} disabled={installingDependencies}>{installingDependencies ? 'Installing...' : 'Install dependencies'}<ArrowRight size={15} aria-hidden="true" /></button>}{dependencyReadiness.status === 'ready' && <button className="secondary-button" type="button" onClick={() => void runQualityGate()} disabled={applyingBaseline}>{applyingBaseline ? 'Running...' : 'Run quality gate'}<CheckCircle2 size={15} aria-hidden="true" /></button>}</div>}
              {applyRun?.status === 'completed' && qualityGateResult?.status === 'passed' && <div className="preview-deployment"><div className="runtime-heading"><div><p className="eyebrow">Dual Preview</p><h3>{previewResult ? `Preview ${previewResult.status}` : 'Deploy Preview Environment'}</h3><p>{previewResult?.status === 'completed' ? `API: ${previewResult.apiBaseUrl} · Pages: ${previewResult.pagesUrl}` : previewResult?.status === 'failed' ? 'Deployment failed. Review steps and cleanup if needed.' : 'Deploy Vercel API + Cloudflare Pages as a joint preview with exact CORS.'}</p></div></div>{!previewResult ? <div className="preview-deploy-form"><label htmlFor="preview-branch">Preview branch</label><input id="preview-branch" value={previewBranch} onChange={event => setPreviewBranch(event.target.value)} placeholder="e.g. pr-42 or feature-x" pattern="[a-z0-9-]+" maxLength={100} /><button className="primary-button" type="button" onClick={() => void deployPreview()} disabled={deployingPreview}>{deployingPreview ? 'Deploying preview...' : 'Deploy Preview'}<ArrowRight size={15} aria-hidden="true" /></button></div> : <div className="preview-steps"><ol>{previewResult.steps.map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{step.status}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>{previewResult.status === 'completed' && <div className="preview-urls"><span>API: <a href={previewResult.apiBaseUrl} target="_blank" rel="noreferrer">{previewResult.apiBaseUrl}</a></span><span>Pages: <a href={previewResult.pagesUrl} target="_blank" rel="noreferrer">{previewResult.pagesUrl}</a></span><span>CORS: <code>{previewResult.corsOrigin}</code></span></div>}{previewResult.cleanupRequired && <button className="secondary-button" type="button" onClick={() => void cleanupPreview()} disabled={deployingPreview}>{deployingPreview ? 'Cleaning up...' : 'Cleanup Preview Projects'}<RefreshCw size={15} aria-hidden="true" /></button>}</div>}</div>}
              {releasePlan && <div className={`production-release ${selected.state.toLowerCase()}`}><div className="runtime-heading"><div><p className="eyebrow">Production release</p><h3>{selected.state === 'DELIVERED' ? 'Released to production' : selected.state === 'AWAITING_APPROVAL' ? 'Waiting for a human approval' : selected.state === 'RELEASING' ? 'Releasing' : 'Request a production release'}</h3><p>Production origin <code>{releasePlan.corsOrigin}</code> · approval is <strong>{releasePlan.productionApproval}</strong> and never automatic.</p></div></div>
                <ol className="release-steps">{(releaseRun?.steps ?? releasePlan.steps).map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{step.status}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>
                {releasePlan.source
                  ? <p className="release-source">Releasing <code>{releasePlan.source.repository}</code> branch <code>{releasePlan.source.branch}</code>, which must carry the accepted commit <code>{releasePlan.source.acceptedCommit.slice(0, 7)}</code>.</p>
                  : <p className="release-source blocked">{releasePlan.sourceReason}</p>}
                {selected.state === 'PREVIEW_READY' && <button className="primary-button" type="button" onClick={() => void requestRelease()} disabled={releaseBusy || !releasePlan.workspace.usable || !releasePlan.source}>{releaseBusy ? 'Requesting...' : 'Request production release'}<ArrowRight size={15} aria-hidden="true" /></button>}
                {selected.state === 'AWAITING_APPROVAL' && <div className="release-approval">{approverField('release-approver', 'Who approves this release?')}<label htmlFor="release-summary">What is being released?</label><textarea id="release-summary" value={releaseSummary} onChange={event => setReleaseSummary(event.target.value)} placeholder="Scope of this production release." maxLength={500} /><button className="primary-button" type="button" onClick={() => void approveRelease()} disabled={releaseBusy}>{releaseBusy ? 'Releasing...' : 'Approve and release to production'}<ShieldCheck size={15} aria-hidden="true" /></button></div>}
                {releaseRun?.status === 'failed' && <button className="secondary-button retry-button" type="button" onClick={() => void retryRelease()} disabled={releaseBusy || releaseRun.attempts >= 3}>{releaseBusy ? 'Retrying...' : releaseRun.attempts >= 3 ? 'Retry limit reached' : 'Retry the approved release'}<RefreshCw size={15} aria-hidden="true" /></button>}
                {releaseEvidence && <div className="release-evidence"><p>Approved by <strong>{releaseEvidence.approvedBy}</strong> at {new Date(releaseEvidence.recordedAt).toLocaleString()} · {releaseEvidence.approvalSummary}</p><div className="preview-urls"><span>API: <a href={releaseEvidence.apiBaseUrl} target="_blank" rel="noreferrer">{releaseEvidence.apiBaseUrl}</a></span><span>Web: <a href={releaseEvidence.webUrl} target="_blank" rel="noreferrer">{releaseEvidence.webUrl}</a></span><span>CORS: <code>{releaseEvidence.corsOrigin}</code></span></div><pre className="evidence-observations">{JSON.stringify(releaseEvidence.observations, null, 2)}</pre></div>}</div>}
              {applyRun?.status === 'completed' && <div className="feature-task"><div className="feature-task-heading"><div><p className="eyebrow">Feature delivery</p><h3>{featureTask ? featureTask.title : 'Define the next feature'}</h3><p>{featureTask ? `Task is ${featureTask.status}. Acceptance criteria are the Agent boundary.` : 'Create a focused task package before asking an Agent to change code.'}</p></div>{featureTask && <span className={`baseline-tag ${featureTask.status === 'approved' ? 'approved' : 'ready'}`}>{featureTask.status}</span>}</div>{!featureTask ? <div className="feature-task-form"><label htmlFor="feature-title">Task title <small>at least 3 characters</small></label><input id="feature-title" value={featureTitle} onChange={event => setFeatureTitle(event.target.value)} placeholder="e.g. Add receipt list" maxLength={120} /><label htmlFor="feature-objective">Objective <small>at least 10 characters</small></label><textarea id="feature-objective" value={featureObjective} onChange={event => setFeatureObjective(event.target.value)} placeholder="What user outcome should this feature deliver?" maxLength={2000} /><label htmlFor="feature-criteria">Acceptance criteria <small>one per line</small></label><textarea id="feature-criteria" value={featureCriteria} onChange={event => setFeatureCriteria(event.target.value)} placeholder="The list renders saved receipts.\nEmpty state is visible." maxLength={4000} /><button className="primary-button" type="button" onClick={() => void createFeatureTask()} disabled={savingFeatureTask}>{savingFeatureTask ? 'Creating task...' : 'Create feature task'}<ArrowRight size={15} aria-hidden="true" /></button></div> : <div className="feature-task-detail"><p>{featureTask.objective}</p><ol>{featureTask.acceptanceCriteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ol>{featureTask.status === 'draft' ? <>{approverField('feature-approver', 'Who approves this task?')}<button className="primary-button" type="button" onClick={() => void approveFeatureTask()} disabled={savingFeatureTask}>{savingFeatureTask ? 'Approving...' : 'Approve task for Agent'}<ShieldCheck size={15} aria-hidden="true" /></button></> : <small>Approved by {featureTask.approvedBy} · {featureTask.approvedAt && formatDate(featureTask.approvedAt)}</small>}</div>}</div>}
              {featureTask?.status === 'approved' && <div className="runtime-panel"><div className="runtime-heading"><div><p className="eyebrow">Agent runtime{selectedAgentId && agents.find(a => a.id === selectedAgentId) ? ` · ${agents.find(a => a.id === selectedAgentId)!.name}` : ''}</p><h3>{runtimeRun ? `${runtimeRun.plan.mode === 'execute' ? 'Codex' : 'Dry-run'} ${runtimeRun.status}` : 'Runtime not prepared'}</h3><p>{runtimeRun?.status === 'completed' ? 'Codex finished. Review the diff and run the Quality Gate before acceptance.' : runtimeRun?.status === 'failed' ? `Codex failed on attempt ${runtimeRun.attempts}. Review the report or retry.` : runtimeRun?.status === 'running' ? 'Codex is working in the approved workspace.' : runtimeRun ? 'No Codex process has started. Review the local plan before explicitly starting execution.' : 'Prepare a guarded Runtime plan from the approved task.'}</p></div>{runtimeRun?.status === 'planned' ? <div className="provider-actions"><button className="secondary-button" type="button" onClick={() => void cancelRuntime()} disabled={preparingRuntime}>{preparingRuntime ? 'Cancelling...' : 'Cancel dry-run'}<RefreshCw size={15} aria-hidden="true" /></button><button className="primary-button" type="button" onClick={() => void executeRuntime()} disabled={preparingRuntime}>{preparingRuntime ? 'Running Codex...' : 'Run Codex'}<ArrowRight size={15} aria-hidden="true" /></button></div> : runtimeRun?.status === 'failed' ? <button className="primary-button" type="button" onClick={() => void retryRuntime()} disabled={preparingRuntime}>{preparingRuntime ? 'Retrying Codex...' : 'Retry Codex'}<RefreshCw size={15} aria-hidden="true" /></button> : !runtimeRun && <button className="secondary-button" type="button" onClick={() => void prepareRuntime()} disabled={preparingRuntime}>{preparingRuntime ? 'Preparing...' : 'Prepare Runtime'}<ArrowRight size={15} aria-hidden="true" /></button>}</div>{gitEvidence && <div className="git-evidence"><span>Branch <strong>{gitEvidence.branch}</strong></span><span>HEAD <strong>{gitEvidence.head.slice(0, 10)}</strong></span><span>Working tree <strong>{gitEvidence.status || 'clean'}</strong></span><span>Diff <strong>{gitEvidence.diffStat || 'no changes'}</strong></span></div>}{runtimeRun?.result?.output && <pre className="provider-report">{runtimeRun.result.output}</pre>}{runtimeRun?.history.length ? <div className="runtime-history"><small>{runtimeRun.history.length} attempt{runtimeRun.history.length === 1 ? '' : 's'} recorded</small></div> : null}</div>}
              {featureTask?.status === 'approved' && runtimeRun && <div className={`acceptance-panel ${acceptance?.status ?? 'pending'}`}><div className="runtime-heading"><div><p className="eyebrow">Human acceptance</p><h3>{acceptance ? `Acceptance ${acceptance.status}` : 'Submit delivery evidence'}</h3><p>{acceptance?.status === 'blocked' ? `Blocked: Quality Gate is ${acceptance.qualityStatus}.` : 'Confirm the acceptance criteria and record what was verified.'}</p></div>{acceptance?.status === 'ready' && <div className="acceptance-approval">{approverField('acceptance-approver', 'Who accepts this delivery?')}<button className="secondary-button" type="button" onClick={() => void approveDelivery()} disabled={submittingAcceptance}>{submittingAcceptance ? 'Approving...' : 'Approve delivery'}<ShieldCheck size={15} aria-hidden="true" /></button></div>}</div>{acceptance?.status !== 'approved' && <div className="acceptance-form"><label htmlFor="acceptance-summary">Acceptance summary <small>at least 10 characters</small></label><textarea id="acceptance-summary" value={acceptanceSummary} onChange={event => setAcceptanceSummary(event.target.value)} placeholder="Describe what was verified and what remains." maxLength={2000} /><label className="check-row"><input type="checkbox" checked={criteriaConfirmed} onChange={event => setCriteriaConfirmed(event.target.checked)} /> I reviewed every acceptance criterion</label><button className="primary-button" type="button" onClick={() => void submitAcceptance()} disabled={submittingAcceptance}>{submittingAcceptance ? 'Submitting...' : 'Submit acceptance evidence'}<ArrowRight size={15} aria-hidden="true" /></button></div>}</div>}
              {finalDeliveryReport && <div className="final-report"><div className="artifact-heading"><div><p className="eyebrow">Evidence bundle</p><h3>Final Delivery Report</h3></div><button className="icon-button" type="button" onClick={() => selected && void loadFinalDeliveryReport(selected.id)} aria-label="Refresh final delivery report" title="Refresh final delivery report"><RefreshCw size={17} /></button></div><pre className="provider-report">{finalDeliveryReport}</pre></div>}
              <p className="baseline-note">No remote resource has been created. The simulator writes only local generated artifacts and an execution manifest.</p>
              <div className="provider-simulation"><div className="provider-simulation-heading"><div><p className="eyebrow">Simulation only</p><h3>Provider lifecycle</h3><p>Plans and verification use in-memory Fake Providers. No GitHub, Supabase, Vercel or Cloudflare API is called.</p></div><span className="dry-run-tag">No external writes</span></div><div className="provider-plan-list">{providerPlans.map(plan => <article className="provider-plan" key={plan.providerId}><div><strong>{plan.providerId}</strong><small>{plan.idempotencyKey}</small></div><ol>{plan.resources.map(resource => <li key={resource.spec.id}><span>{resource.spec.id}</span><em>{resource.action}</em><small>{resource.reason}</small></li>)}</ol></article>)}</div><div className="provider-actions"><button className="secondary-button" type="button" onClick={() => void verifyProviders()} disabled={verifyingProviders}>{verifyingProviders ? 'Verifying...' : 'Verify simulation state'}<RefreshCw size={15} aria-hidden="true" /></button>{baselineApproval && <button className="secondary-button" type="button" onClick={() => void applyFakeProviders()} disabled={applyingFakeProviders}>{applyingFakeProviders ? 'Applying simulation...' : 'Apply Fake Providers'}<ArrowRight size={15} aria-hidden="true" /></button>}</div>{providerVerification && <div className="provider-verification">{providerVerification.map(item => <span className={item.verified ? 'verified' : 'unverified'} key={item.providerId}>{item.providerId}: {item.verified ? 'verified' : `missing ${item.missing.length}, drift ${item.mismatched.length}`}</span>)}</div>}{providerReport && <pre className="provider-report">{providerReport}</pre>}</div>
            </section>}
          </section>

          <aside className="right-rail">
            <form className="blueprint-panel" onSubmit={saveBlueprint}>
              <div className="panel-title"><div><p className="eyebrow">{selected ? `Revision ${selected.blueprint.metadata.revision + 1}` : 'New baseline'}</p><h2>{selected ? 'Edit Blueprint' : 'Start a Blueprint'}</h2></div><Sparkles size={20} aria-hidden="true" /></div>
              <div className="mode-switch" role="group" aria-label="Blueprint mode">
                <button className={answers.mode === 'beginner' ? 'active' : ''} type="button" onClick={() => setAnswer('mode', 'beginner')}>Beginner</button>
                <button className={answers.mode === 'professional' ? 'active' : ''} type="button" onClick={() => setAnswer('mode', 'professional')}>Professional</button>
              </div>
              <label htmlFor="project-name">Project name</label>
              <input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Receipt Desk" maxLength={80} disabled={Boolean(selected)} />
              <label htmlFor="product-intent">What should this product do?</label>
              <textarea id="product-intent" value={answers.productIntent} onChange={event => setAnswer('productIntent', event.target.value)} placeholder="Describe the user problem and desired outcome." maxLength={500} />

              <fieldset className="choice-group"><legend>Data sensitivity</legend><div className="choice-grid">
                <button className={answers.dataSensitivity === 'standard' ? 'selected' : ''} type="button" onClick={() => setAnswer('dataSensitivity', 'standard')}><CheckCircle2 size={15} />Standard</button>
                <button className={answers.dataSensitivity === 'sensitive' ? 'selected' : ''} type="button" onClick={() => setAnswer('dataSensitivity', 'sensitive')}><ShieldCheck size={15} />Sensitive</button>
              </div></fieldset>

              {isProfessional && <>
                <fieldset className="choice-group ownership-group"><legend>Resource ownership</legend><p>These names are saved in the next Blueprint revision. Discovery confirms only the current CLI identity; select the final target yourself.</p>
                  <label htmlFor="github-owner">GitHub owner or organization</label>
                  <input id="github-owner" value={answers.githubOwner} onChange={event => setAnswer('githubOwner', event.target.value)} placeholder="e.g. acme" maxLength={120} />
                  <label htmlFor="supabase-organization">Supabase organization</label>
                  <input id="supabase-organization" value={answers.supabaseOrganization} onChange={event => setAnswer('supabaseOrganization', event.target.value)} placeholder="e.g. acme" maxLength={120} />
                  <label htmlFor="vercel-team">Vercel team</label>
                  <input id="vercel-team" value={answers.vercelTeam} onChange={event => setAnswer('vercelTeam', event.target.value)} placeholder="e.g. acme" maxLength={120} />
                  <label htmlFor="cloudflare-account">Cloudflare account</label>
                  <input id="cloudflare-account" value={answers.cloudflareAccount} onChange={event => setAnswer('cloudflareAccount', event.target.value)} placeholder="e.g. acme" maxLength={120} />
                </fieldset>
                <fieldset className="choice-group"><legend>Preview workflow</legend><div className="choice-stack">
                  <label><input type="radio" name="preview" checked={answers.previewStrategy === 'per-pull-request'} onChange={() => setAnswer('previewStrategy', 'per-pull-request')} />Per pull request</label>
                  <label><input type="radio" name="preview" checked={answers.previewStrategy === 'stable-dev-api'} onChange={() => setAnswer('previewStrategy', 'stable-dev-api')} />Stable dev API</label>
                </div></fieldset>
                <fieldset className="choice-group"><legend>Analytics</legend><div className="choice-stack">
                  <label><input type="checkbox" checked={answers.analyticsProviders.includes('ga4')} onChange={() => toggleAnalytics('ga4')} />Google Analytics 4</label>
                  <label><input type="checkbox" checked={answers.analyticsProviders.includes('clarity')} onChange={() => toggleAnalytics('clarity')} />Microsoft Clarity</label>
                </div></fieldset>
                <label htmlFor="custom-instructions">Custom implementation note</label>
                <textarea id="custom-instructions" value={answers.customInstructions} onChange={event => setAnswer('customInstructions', event.target.value)} placeholder="A note to preserve as a manual action." maxLength={1000} />
              </>}

              <p className="form-note">The fixed baseline uses React/Vite, Hono, Supabase, Cloudflare Pages and Vercel Functions. Cloud accounts and production releases remain human-approved.</p>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : selected ? 'Save new revision' : 'Create Blueprint'}<ArrowRight size={16} aria-hidden="true" /></button>
            </form>
            <section className="connector-panel" id="connections">
              <div className="panel-title"><div><p className="eyebrow">Local only</p><h2>Connector readiness</h2></div><PlugZap size={19} aria-hidden="true" /></div>
              <p className="form-note">Checks installed command-line tools only. It does not authenticate, access accounts or create resources.</p>
              <button className="secondary-button" type="button" onClick={() => void runPreflight()} disabled={checkingPreflight}>{checkingPreflight ? 'Checking...' : 'Run local preflight'}<RefreshCw size={15} aria-hidden="true" /></button>
              <button className="secondary-button discovery-button" type="button" onClick={() => void discoverAccounts()} disabled={discoveringAccounts}>{discoveringAccounts ? 'Discovering...' : 'Discover active identities'}<PlugZap size={15} aria-hidden="true" /></button>
              {preflight && <>
                <p className="preflight-summary">{preflight.readyForAccountDiscovery ? 'All local tools are ready for account discovery.' : 'Some local tools need attention before account discovery.'}</p>
                <div className="connector-list">{preflight.connectors.map(connector => <article className="connector" key={connector.id}>
                  <div><h3>{connector.title}</h3><p>{connector.version ?? connector.command}</p><small>{connector.detail}</small><em>{connector.nextAction}</em></div><span className={`connector-status ${connector.status}`}>{connector.status === 'available' ? 'Available' : connector.status === 'missing' ? 'Install required' : 'Needs attention'}</span>
                </article>)}</div>
              </>}
              {accountDiscovery && <div className="discovery-list">{accountDiscovery.accounts.map(account => <article className="connector" key={account.id}>
                <div><h3>{account.title}</h3><p>{account.identity ?? 'No identity returned'}</p><small>{account.detail}</small><em>{account.nextAction}</em></div><span className={`connector-status ${account.status}`}>{account.status === 'authenticated' ? 'Authenticated' : account.status === 'manual' ? 'Manual' : account.status === 'missing' ? 'Install required' : 'Sign in required'}</span>
              </article>)}</div>}
            </section>
            <section className="credential-panel" id="credentials">
              <div className="panel-title"><div><p className="eyebrow">Local only</p><h2>Credentials</h2></div><KeyRound size={19} aria-hidden="true" /></div>
              <p className="form-note">Tokens are stored only in <code>~/.agent-dev/credentials.txt</code> on your machine. They are never uploaded to any server.</p>

              {guideMode && credentialMeta?.keys.length === 0 && (
                <div className="credential-guide">
                  <div className="guide-progress">
                    <span>Step {guideStep + 1} of {PROVIDER_FIELDS.length}</span>
                    <button className="guide-skip-button" type="button" onClick={() => setGuideMode(false)}>Skip guide</button>
                  </div>
                  {PROVIDER_FIELDS.map((field, index) => (
                    <div className={`guide-step ${index === guideStep ? 'active' : index < guideStep ? 'done' : ''}`} key={field.key}>
                      <div className="guide-step-header">
                        <strong>{field.label}</strong>
                        {index < guideStep && credentialInputs[field.key] ? <span className="verify-status valid">Filled</span> : null}
                      </div>
                      {index === guideStep && <>
                        <small>{field.hint}</small>
                        <a href={field.tutorial} target="_blank" rel="noopener noreferrer">How to get this token</a>
                        <input type="password" className="credential-input" value={credentialInputs[field.key] ?? ''} onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))} placeholder={`Paste ${field.label}`} />
                        <div className="guide-step-actions">
                          {guideStep > 0 && <button className="secondary-button" type="button" onClick={() => setGuideStep(guideStep - 1)}>Back</button>}
                          {guideStep < PROVIDER_FIELDS.length - 1
                            ? <button className="primary-button" type="button" onClick={() => setGuideStep(guideStep + 1)}>Next</button>
                            : <button className="primary-button" type="button" onClick={() => { setGuideMode(false); void saveCredentialValues(); }}>Save all</button>}
                        </div>
                      </>}
                    </div>
                  ))}
                </div>
              )}

              {!guideMode && <>
                <div className="credential-list">
                  {PROVIDER_FIELDS.map(field => {
                    const connected = credentialMeta?.keys.includes(field.key) ?? false;
                    const verifyResult = verifyResults.find(r => r.providerId === field.providerId);
                    return (
                      <article className="credential-item" key={field.key}>
                        <div className="credential-header">
                          <strong>{field.label}</strong>
                          <span className={`credential-status ${connected ? 'connected' : 'missing'}`}>{connected ? 'Connected' : 'Not set'}</span>
                          {verifyResult && <span className={`verify-status ${verifyResult.status}`}>{verifyResult.status === 'valid' ? 'Valid' : verifyResult.status === 'invalid' ? 'Invalid' : 'N/A'}</span>}
                        </div>
                        <small className="credential-hint">{field.hint}</small>
                        <a className="credential-tutorial" href={field.tutorial} target="_blank" rel="noopener noreferrer">How to get this token</a>
                        {connected ? (
                          <button className="quiet-button credential-delete" type="button" onClick={() => void deleteCredential(field.key)}>Delete</button>
                        ) : (
                          <input
                            type="password"
                            className="credential-input"
                            value={credentialInputs[field.key] ?? ''}
                            onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))}
                            placeholder={`Paste ${field.label}`}
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
                <div className="credential-actions-row">
                  <button className="primary-button" type="button" onClick={() => void saveCredentialValues()} disabled={savingCredentials}>
                    {savingCredentials ? 'Saving...' : 'Save to local'}
                    <KeyRound size={15} aria-hidden="true" />
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void verifyAllCredentials()} disabled={verifying}>
                    {verifying ? 'Verifying...' : 'Verify credentials'}
                    <ShieldCheck size={15} aria-hidden="true" />
                  </button>
                </div>
                {verifyResults.length > 0 && (
                  <div className="verify-results">
                    {verifyResults.map(result => (
                      <div className={`verify-item ${result.status}`} key={result.providerId}>
                        <strong>{result.providerId}</strong>
                        <span>{result.status}</span>
                        <small>{result.detail}</small>
                      </div>
                    ))}
                  </div>
                )}

                {/* Supabase Manual Setup */}
                <div className="supabase-manual">
                  <div className="section-heading"><div><p className="eyebrow">Manual setup</p><h3>Supabase Configuration</h3></div></div>
                  <p className="form-note">Supabase requires manual project creation. Follow these steps, then paste your credentials below.</p>
                  <ol className="supabase-steps">
                    <li>Go to <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard</a> and create a new project</li>
                    <li>Wait for the project to finish provisioning</li>
                    <li>Go to Settings &gt; API in your project dashboard</li>
                    <li>Copy the Project URL and the anon/public key</li>
                  </ol>
                  <div className="supabase-inputs">
                    <label htmlFor="supabase-url">Project URL</label>
                    <input id="supabase-url" className="credential-input" value={supabaseInputs.SUPABASE_URL} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_URL: event.target.value }))} placeholder="https://xxxxx.supabase.co" />
                    <label htmlFor="supabase-anon">Anon/Public Key</label>
                    <input id="supabase-anon" className="credential-input" value={supabaseInputs.SUPABASE_ANON_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_ANON_KEY: event.target.value }))} placeholder="eyJhbGciOi..." />
                    <label htmlFor="supabase-service">Service Role Key (optional)</label>
                    <input id="supabase-service" className="credential-input" value={supabaseInputs.SUPABASE_SERVICE_ROLE_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_SERVICE_ROLE_KEY: event.target.value }))} placeholder="eyJhbGciOi..." />
                    <button className="secondary-button" type="button" onClick={() => void saveSupabaseManual()} disabled={savingCredentials}>{savingCredentials ? 'Saving...' : 'Save Supabase config'}<KeyRound size={14} aria-hidden="true" /></button>
                  </div>
                </div>

                {/* Custom API Keys */}
                <div className="custom-key-section">
                  <div className="section-heading"><div><p className="eyebrow">Third-party</p><h3>Custom API Keys</h3></div></div>
                  {credentialMeta?.keys.filter(key => !PROVIDER_FIELDS.some(f => f.key === key)).map(key => (
                    <article className="credential-item" key={key}>
                      <div className="credential-header">
                        <strong>{key}</strong>
                        <span className="credential-status connected">Configured</span>
                      </div>
                      <button className="quiet-button credential-delete" type="button" onClick={() => void deleteCredential(key)}>Delete</button>
                    </article>
                  ))}
                  <div className="custom-key-form">
                    <label htmlFor="custom-key-name">Key name (e.g. OPENAI_API_KEY)</label>
                    <input id="custom-key-name" value={newCustomKey} onChange={event => setNewCustomKey(event.target.value)} placeholder="OPENAI_API_KEY" maxLength={60} />
                    <label htmlFor="custom-key-value">Value</label>
                    <input id="custom-key-value" type="password" value={newCustomValue} onChange={event => setNewCustomValue(event.target.value)} placeholder="sk-..." maxLength={200} />
                    <button className="secondary-button" type="button" onClick={() => void addCustomKey()} disabled={savingCredentials}>{savingCredentials ? 'Saving...' : 'Add custom key'}<ArrowRight size={14} aria-hidden="true" /></button>
                  </div>
                </div>
              </>}

              {credentialMeta?.updatedAt && <small className="credential-updated">Last updated: {formatDate(credentialMeta.updatedAt)}</small>}
              {selected && projectResources && (
                <div className="credential-resources">
                  <p className="eyebrow">Project resources</p>
                  <div className="resource-list">
                    {Object.entries(projectResources.providers).map(([providerId, state]) => (
                      <article className="resource-item" key={providerId}>
                        <strong>{providerId}</strong>
                        <code>{'url' in state ? String(state.url) : 'projectId' in state ? String(state.projectId) : 'projectRef' in state ? String(state.projectRef) : 'created'}</code>
                      </article>
                    ))}
                  </div>
                  <button className="secondary-button" type="button" onClick={() => void regenerateEnv()} disabled={regeneratingEnv}>
                    {regeneratingEnv ? 'Regenerating...' : 'Regenerate .env'}
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </section>
            <section className="agent-catalog-panel" id="agents">
              <div className="panel-title"><div><p className="eyebrow">Local runtime</p><h2>Agent Catalog</h2></div><button className="icon-button" type="button" onClick={() => void loadAgents()} disabled={loadingAgents} aria-label="Refresh agents" title="Refresh agents"><RefreshCw size={17} /></button></div>
              <p className="form-note">Detected Agents can be inspected here. Only verified execution adapters can run tasks. Custom Agents are persisted in .agent-dev/agents.conf.</p>
              {loadingAgents && agents.length === 0 ? <p className="empty-state">Detecting local Agents...</p> : agents.length === 0 ? <p className="empty-state">No Agents found.</p> : <div className="agent-list">{agents.map(agent => (
                <button className={`agent-item ${selectedAgentId === agent.id ? 'selected' : ''}`} type="button" key={agent.id} onClick={() => void probeAgent(agent)} disabled={!agent.detected || probingAgentId !== null}>
                  <div className="agent-info"><div className="agent-header"><strong>{agent.name}</strong><span className={`agent-source ${agent.source}`}>{agent.source}</span></div>{agent.version && <small className="agent-version">{agent.version}</small>}<small className="agent-detail">{probingAgentId === agent.id ? 'Running read-only capability probe...' : agent.detail}</small>{agent.capabilities.length > 0 && <div className="agent-caps">{agent.capabilities.map(cap => <span className="agent-cap" key={cap}>{cap}</span>)}</div>}{agentProbes[agent.id] && <div className="agent-caps"><span className="agent-cap">{agentProbes[agent.id].nonInteractive ? 'non-interactive: yes' : 'non-interactive: unknown'}</span><span className="agent-cap">{agentProbes[agent.id].workspaceWrite ? 'workspace-write: yes' : 'workspace-write: no'}</span><span className="agent-cap">{`adapter: ${agentProbes[agent.id].adapterStatus}`}</span></div>}<code className="agent-command">{agent.launchCommand}</code></div>
                  <span className={`agent-status ${agent.detected ? 'detected' : 'missing'}`}>{agent.detected ? 'Detected' : 'Not found'}</span>
                </button>
              ))}</div>}
              <details className="agent-form-toggle">
                <summary>Add a custom Agent</summary>
                <div className="agent-form">
                  <label htmlFor="custom-agent-name">Agent name</label>
                  <input id="custom-agent-name" value={customAgentName} onChange={event => setCustomAgentName(event.target.value)} placeholder="e.g. My Custom Agent" maxLength={80} />
                  <label htmlFor="custom-agent-command">Launch command</label>
                  <input id="custom-agent-command" value={customAgentCommand} onChange={event => setCustomAgentCommand(event.target.value)} placeholder="e.g. my-agent" maxLength={200} />
                  <button className="primary-button" type="button" onClick={() => void addCustomAgent()} disabled={savingAgent}>{savingAgent ? 'Registering...' : 'Register Agent'}<ArrowRight size={15} aria-hidden="true" /></button>
                </div>
              </details>
            </section>
            <section className="activity-panel" id="activity"><div className="panel-title"><h2>Activity</h2><Activity size={18} aria-hidden="true" /></div><ol>{activity.map(item => <li key={item.id}><span>{item.text}</span><time>{item.time}</time></li>)}</ol></section>
          </aside>
        </div>
      </section>
    </main>
  );
}
