import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, CircleDot, FolderKanban, KeyRound, Moon, PlugZap, RefreshCw, ShieldCheck, Sparkles, Sun,
} from 'lucide-react';
import { useI18n, type KeyPath } from './i18n/i18n';
import { Dashboard } from './views/Dashboard';
import { useTheme } from './theme/theme';
import { baselineProvidersFor, getBlueprintDecisions, runtimeProviderSchema, type BaselinePlan, type BlueprintAnswers, type DryRunPlan } from '@agent-dev/blueprint';
// Import CONFIRMATIONS from the sub-path: the policy package's top-level entry re-exports
// node-only modules (connectors) that break the Vite browser build. This file is a pure constant.
import { CONFIRMATIONS } from '@agent-dev/policy/confirmations';
import type { AccountDiscoveryReport, ConnectorPreflightReport } from '@agent-dev/policy';
import { FailureDisplay } from './components/FailureDisplay';
import { CredentialBackendStatus } from './components/CredentialBackendStatus';
import type {
  Project, ProjectDetail, ActivityEntry, BaselineApproval, ApplyStep, ApplyRun, DependencyReadiness,
  QualityGateResult, DependencyInstallResult, FeatureTask, RuntimeAttempt, RuntimeRun, GitEvidence,
  PrEvidence, PreviewEvidence, AcceptanceRecord, ProviderPlan, ProviderVerification, AgentDescriptor,
  AgentCapabilityProbe, AgentProfile, CredentialBackendInfo, CredentialMeta, ProjectResources, CredentialVerifyResult, PreviewStep,
  PreviewDeploymentResult, WorkspaceVerification, ReleaseStep, ReleaseRun, ReleaseEvidence,
  ReleaseSource, ReleasePlan, View,
} from './types';
import { formatDate, answersFromBlueprint, defaultAnswers, recordApprover } from './lib/utils';
import { agentCopyKeys } from './lib/agent-copy';
import { PRODUCT_TYPE_LABEL_KEYS } from './lib/product-type';


export function App() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [view, setView] = useState<View>({ kind: 'dashboard' });

  const resetView = () => setView({ kind: 'dashboard' });

  const providerFields = useMemo(() => [
    { key: 'GITHUB_TOKEN' as const, label: t('credentials.provider.github.label'), tutorial: 'https://github.com/settings/tokens', hint: t('credentials.provider.github.hint'), providerId: 'github' as const },
    { key: 'VERCEL_TOKEN' as const, label: t('credentials.provider.vercel.label'), tutorial: 'https://vercel.com/account/tokens', hint: t('credentials.provider.vercel.hint'), providerId: 'vercel' as const },
    { key: 'CLOUDFLARE_API_TOKEN' as const, label: t('credentials.provider.cloudflare.label'), tutorial: 'https://dash.cloudflare.com/profile/api-tokens', hint: t('credentials.provider.cloudflare.hint'), providerId: 'cloudflare' as const },
    { key: 'SUPABASE_ACCESS_TOKEN' as const, label: t('credentials.provider.supabase.label'), tutorial: 'https://supabase.com/dashboard/account/tokens', hint: t('credentials.provider.supabase.hint'), providerId: 'supabase' as const },
  ], [t]);

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
  const [activity, setActivity] = useState<ActivityEntry[]>([{ id: 'local-ready', text: t('activity.localReady'), time: t('activity.now') }]);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<BlueprintAnswers>(defaultAnswers);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [daemonOnline, setDaemonOnline] = useState<boolean | null>(null);

  // Keyed on `kind` rather than the whole view so switching tabs inside a project keeps a message
  // the user has not read yet, while leaving a view drops an error that no longer has any context.
  useEffect(() => { setError(''); }, [view.kind]);
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
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: '',
    description: '',
    baseAgentId: '',
    icon: '',
    systemPrompt: '',
    model: '',
    temperature: '',
    allowedTools: '',
    envKey: '',
    envValue: '',
    envPairs: [] as { key: string; value: string }[],
  });
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState('');
  const [testResult, setTestResult] = useState<{ output: string; exitCode: number | null; status: 'idle' | 'running' | 'done' | 'error' }>({ output: '', exitCode: null, status: 'idle' });
  const [importError, setImportError] = useState('');
  const [agentProbes, setAgentProbes] = useState<Record<string, AgentCapabilityProbe>>({});
  const [probingAgentId, setProbingAgentId] = useState<string | null>(null);
  const [credentialMeta, setCredentialMeta] = useState<CredentialMeta | null>(null);
  const [credentialBackend, setCredentialBackend] = useState<CredentialBackendInfo | null>(null);
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
  const [approver, setApprover] = useState(() => localStorage.getItem('agent-dev.approver') ?? '');
  const [releaseSummary, setReleaseSummary] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [recoveringWorkspace, setRecoveringWorkspace] = useState(false);
  const [deployingPreview, setDeployingPreview] = useState(false);
  const [blueprintDiff, setBlueprintDiff] = useState<{ added: string[]; removed: string[]; modified: string[] } | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [importingBlueprint, setImportingBlueprint] = useState(false);
  const [blueprintImportResult, setBlueprintImportResult] = useState<string | null>(null);
  const [editingPipeline, setEditingPipeline] = useState(false);
  const [pipelineDraft, setPipelineDraft] = useState<{ id: string; name: string; profileId: string; prompt: string }[]>([]);
  const [savingPipeline, setSavingPipeline] = useState(false);

  const decisions = useMemo(() => selected ? getBlueprintDecisions(selected.blueprint) : [], [selected]);
  const selectedArtifact = useMemo(
    () => dryRun?.artifacts.find(artifact => artifact.id === selectedArtifactId) ?? null,
    [dryRun, selectedArtifactId],
  );

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(t('errors.daemonUnavailable'));
      const payload = await response.json() as { projects: Project[] };
      setProjects(payload.projects);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadProjects'));
    } finally {
      setLoading(false);
    }
  };

  const selectProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error(t('errors.loadBlueprint'));
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
      setView({ kind: 'project', projectId, tab: 'blueprint' });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadBlueprint'));
    }
  };

  const loadBaselinePlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/baseline-plan`);
      if (!response.ok) throw new Error(t('errors.prepareBaselinePlan'));
      const payload = await response.json() as { plan: BaselinePlan; approval: BaselineApproval | null };
      setBaselinePlan(payload.plan);
      setBaselineApproval(payload.approval);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.prepareBaselinePlan'));
    }
  };

  const loadDryRun = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/dry-run`);
      if (!response.ok) throw new Error(t('errors.prepareDeliveryPlan'));
      const payload = await response.json() as { plan: DryRunPlan };
      setDryRun(payload.plan);
      setSelectedArtifactId(current => current && payload.plan.artifacts.some(artifact => artifact.id === current)
        ? current
        : payload.plan.artifacts[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.prepareDeliveryPlan'));
    }
  };

  const loadApplyRun = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/apply`);
      if (!response.ok) throw new Error(t('errors.loadApplyRun'));
      const payload = await response.json() as { run: ApplyRun | null };
      setApplyRun(payload.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadApplyRun'));
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

  const recordApproverLocal = (): string => {
    const name = approver.trim();
    if (name) localStorage.setItem('agent-dev.approver', name);
    return name;
  };

  const approverField = (id: string, prompt: string) => (
    <div className="approver-field">
      <label htmlFor={id}>{prompt}</label>
      <input id={id} value={approver} onChange={event => setApprover(event.target.value)} placeholder={t('common.namePlaceholder')} maxLength={120} />
    </div>
  );

  const requestRelease = async () => {
    if (!selected || releaseBusy) return;
    setReleaseBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/release/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.REQUEST_RELEASE }),
      });
      const payload = await response.json() as { state?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? t('errors.requestRelease'));
      await selectProject(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.requestRelease'));
    } finally {
      setReleaseBusy(false);
    }
  };

  const approveRelease = async () => {
    if (!selected || releaseBusy) return;
    const approvedBy = recordApproverLocal();
    if (!approvedBy || releaseSummary.trim().length === 0) {
      setError(t('errors.releaseNeedsApprover'));
      return;
    }
    if (!window.confirm(t('confirmations.releaseToProduction', { name: selected.name, approvedBy }))) return;
    setReleaseBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/release/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.APPROVE_RELEASE, approvedBy, summary: releaseSummary.trim() }),
      });
      const payload = await response.json() as { releaseRun?: ReleaseRun; evidence?: ReleaseEvidence; error?: string };
      if (payload.error) throw new Error(payload.error);
      if (payload.releaseRun) setReleaseRun(payload.releaseRun);
      if (payload.evidence) setReleaseEvidence(payload.evidence);
      setError(response.ok ? '' : t('errors.releaseFailed'));
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.approveRelease'));
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
        body: JSON.stringify({ confirmation: CONFIRMATIONS.RETRY_RELEASE }),
      });
      const payload = await response.json() as { releaseRun?: ReleaseRun; evidence?: ReleaseEvidence; error?: string };
      if (payload.error) throw new Error(payload.error);
      if (payload.releaseRun) setReleaseRun(payload.releaseRun);
      if (payload.evidence) setReleaseEvidence(payload.evidence);
      setError(response.ok ? '' : t('errors.releaseFailedAgain'));
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.retryRelease'));
    } finally {
      setReleaseBusy(false);
    }
  };

  const recoverWorkspace = async () => {
    if (!selected || recoveringWorkspace) return;
    if (!window.confirm(t('errors.recoverWorkspaceConfirm'))) return;
    setRecoveringWorkspace(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/apply/recover`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.RECOVER_WORKSPACE }),
      });
      const payload = await response.json() as { run?: ApplyRun; abandoned?: { workspacePath: string }; error?: string };
      if (!payload.run) throw new Error(payload.error ?? t('errors.recoverWorkspace'));
      setApplyRun(payload.run);
      setPreviewResult(null);
      setError(response.ok ? '' : t('errors.recoveryWorkspaceFailed'));
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.recoverWorkspace'));
    } finally {
      setRecoveringWorkspace(false);
    }
  };

  const loadDependencyReadiness = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/dependencies`);
      if (!response.ok) throw new Error(t('errors.inspectDependencies'));
      const payload = await response.json() as { readiness: DependencyReadiness };
      setDependencyReadiness(payload.readiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.inspectDependencies'));
    }
  };

  const loadQualityGate = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/quality-gate`);
      if (!response.ok) throw new Error(t('errors.loadQualityGate'));
      const payload = await response.json() as { result: QualityGateResult | null };
      setQualityGateResult(payload.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadQualityGate'));
    }
  };

  const loadFeatureTask = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/feature-task`);
      if (!response.ok) throw new Error(t('errors.loadFeatureTask'));
      const payload = await response.json() as { task: FeatureTask | null };
      setFeatureTask(payload.task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadFeatureTask'));
    }
  };

  const loadRuntimePlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/plan`);
      if (response.status === 409) { setRuntimeRun(null); return; }
      if (!response.ok) throw new Error(t('errors.loadRuntimePlan'));
      const payload = await response.json() as { run: RuntimeRun | null };
      setRuntimeRun(payload.run);
      if (payload.run) await loadGitEvidence(projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadRuntimePlan'));
    }
  };

  const loadGitEvidence = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runtime/evidence`);
      if (!response.ok) throw new Error(t('errors.loadGitEvidence'));
      const payload = await response.json() as { evidence: GitEvidence };
      setGitEvidence(payload.evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadGitEvidence'));
    }
  };

  const loadAcceptance = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/acceptance`);
      if (!response.ok) throw new Error(t('errors.loadAcceptance'));
      const payload = await response.json() as { acceptance: AcceptanceRecord | null };
      setAcceptance(payload.acceptance);
      if (payload.acceptance) { setAcceptanceSummary(payload.acceptance.summary); setCriteriaConfirmed(payload.acceptance.criteriaConfirmed); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadAcceptance'));
    }
  };

  const loadFinalDeliveryReport = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/delivery-report`);
      if (!response.ok) throw new Error(t('errors.loadFinalDeliveryReport'));
      const payload = await response.json() as { report: string };
      setFinalDeliveryReport(payload.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadFinalDeliveryReport'));
    }
  };

  const loadDeliveryEvidence = async (projectId: string) => {
    try {
      const [prResponse, previewResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/delivery/pr-evidence`),
        fetch(`/api/projects/${projectId}/delivery/preview-evidence`),
      ]);
      if (!prResponse.ok || !previewResponse.ok) throw new Error(t('errors.loadDeliveryEvidence'));
      const prPayload = await prResponse.json() as { evidence: PrEvidence | null };
      const previewPayload = await previewResponse.json() as { evidence: PreviewEvidence | null };
      setPrEvidence(prPayload.evidence);
      setPreviewEvidence(previewPayload.evidence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadDeliveryEvidence'));
    }
  };

  const openPullRequest = async () => {
    if (!selected || selected.state !== 'LOCAL_ACCEPTED') return;
    setRecordingDeliveryEvidence(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/delivery/pull-request`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.OPEN_PULL_REQUEST }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? t('errors.openPullRequest'));
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.openPullRequest'));
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
        body: JSON.stringify({ confirmation: CONFIRMATIONS.RECORD_PREVIEW_EVIDENCE, apiUrl: previewApiUrl.trim(), webUrl: previewWebUrl.trim(), smokeTest: previewSmokeTest.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? t('errors.recordPreviewEvidence'));
      setPreviewApiUrl(''); setPreviewWebUrl(''); setPreviewSmokeTest('');
      await selectProject(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.recordPreviewEvidence'));
    } finally {
      setRecordingDeliveryEvidence(false);
    }
  };

  const loadProviderPlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/provider-plan`);
      if (!response.ok) throw new Error(t('errors.loadProviderPlan'));
      const payload = await response.json() as { plans: ProviderPlan[] };
      setProviderPlans(payload.plans);
      setProviderVerification(null);
      setProviderReport('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadProviderPlan'));
    }
  };

  const loadAgents = async () => {
    setLoadingAgents(true);
    try {
      const response = await fetch('/api/runtime/catalog');
      if (!response.ok) throw new Error(t('errors.loadAgentCatalog'));
      const payload = await response.json() as { agents: AgentDescriptor[] };
      setAgents(payload.agents);
      setSelectedAgentId(current => {
        if (current && payload.agents.some(agent => agent.id === current)) return current;
        const firstDetected = payload.agents.find(agent => agent.detected);
        return firstDetected?.id ?? payload.agents[0]?.id ?? null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadAgentCatalog'));
    } finally {
      setLoadingAgents(false);
    }
  };

  const loadProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const response = await fetch('/api/runtime/profiles');
      if (!response.ok) throw new Error(t('errors.loadAgentProfiles'));
      const payload = await response.json() as { profiles: AgentProfile[] };
      setProfiles(payload.profiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadAgentProfiles'));
    } finally {
      setLoadingProfiles(false);
    }
  };

  const resetProfileForm = () => {
    setProfileForm({
      name: '', description: '', baseAgentId: '', icon: '',
      systemPrompt: '', model: '', temperature: '', allowedTools: '',
      envKey: '', envValue: '', envPairs: [],
    });
    setEditingProfileId(null);
  };

  const buildProfileOverrides = () => {
    const overrides: AgentProfile['overrides'] = {};
    if (profileForm.systemPrompt.trim()) overrides.systemPrompt = profileForm.systemPrompt.trim();
    if (profileForm.model.trim()) overrides.model = profileForm.model.trim();
    if (profileForm.temperature.trim()) {
      const t = parseFloat(profileForm.temperature);
      if (!isNaN(t)) overrides.temperature = t;
    }
    if (profileForm.allowedTools.trim()) {
      overrides.allowedTools = profileForm.allowedTools.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (profileForm.envPairs.length > 0) {
      const env: Record<string, string> = {};
      for (const pair of profileForm.envPairs) {
        if (pair.key.trim()) env[pair.key.trim()] = pair.value;
      }
      if (Object.keys(env).length > 0) overrides.env = env;
    }
    return overrides;
  };

  const createProfile = async () => {
    if (!profileForm.name.trim() || !profileForm.baseAgentId) return;
    setSavingProfile(true);
    try {
      const response = await fetch('/api/runtime/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: profileForm.name.trim(),
          description: profileForm.description.trim() || undefined,
          baseAgentId: profileForm.baseAgentId,
          icon: profileForm.icon.trim() || undefined,
          overrides: buildProfileOverrides(),
        }),
      });
      const payload = await response.json() as { profile?: AgentProfile; error?: string; details?: string[] };
      if (!response.ok || !payload.profile) throw new Error(payload.error ?? payload.details?.join('; ') ?? t('errors.createProfile'));
      setProfiles(current => [...current, payload.profile!]);
      resetProfileForm();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.createProfile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const updateProfile = async () => {
    if (!editingProfileId || !profileForm.name.trim()) return;
    setSavingProfile(true);
    try {
      const response = await fetch(`/api/runtime/profiles/${encodeURIComponent(editingProfileId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: profileForm.name.trim(),
          description: profileForm.description.trim(),
          icon: profileForm.icon.trim() || undefined,
          overrides: buildProfileOverrides(),
        }),
      });
      const payload = await response.json() as { profile?: AgentProfile; error?: string; details?: string[] };
      if (!response.ok || !payload.profile) throw new Error(payload.error ?? payload.details?.join('; ') ?? t('errors.updateProfile'));
      setProfiles(current => current.map(p => p.id === editingProfileId ? payload.profile! : p));
      resetProfileForm();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.updateProfile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const openEditProfile = (profile: AgentProfile) => {
    setEditingProfileId(profile.id);
    setProfileForm({
      name: profile.name,
      description: profile.description ?? '',
      baseAgentId: profile.baseAgentId,
      icon: profile.icon ?? '',
      systemPrompt: profile.overrides.systemPrompt ?? '',
      model: profile.overrides.model ?? '',
      temperature: profile.overrides.temperature?.toString() ?? '',
      allowedTools: profile.overrides.allowedTools?.join(', ') ?? '',
      envKey: '',
      envValue: '',
      envPairs: Object.entries(profile.overrides.env ?? {}).map(([key, value]) => ({ key, value })),
    });
  };

  const deleteProfile = async (profileId: string) => {
    if (!window.confirm(t('errors.deleteProfileConfirm'))) return;
    try {
      const response = await fetch(`/api/runtime/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(t('errors.deleteProfile'));
      setProfiles(current => current.filter(p => p.id !== profileId));
      if (selectedAgentId === profileId) setSelectedAgentId(null);
      if (editingProfileId === profileId) resetProfileForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.deleteProfile'));
    }
  };

  const exportProfile = (profile: AgentProfile) => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profile-${profile.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllProfiles = () => {
    if (profiles.length === 0) return;
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProfiles = async (file: File) => {
    setImportError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const toImport: AgentProfile[] = Array.isArray(data) ? data : [data];
      let imported = 0;
      for (const p of toImport) {
        if (!p.name || !p.baseAgentId) continue;
        // Skip if profile with same id already exists
        if (profiles.some(existing => existing.id === p.id)) continue;
        const response = await fetch('/api/runtime/profiles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: p.name,
            description: p.description,
            baseAgentId: p.baseAgentId,
            icon: p.icon,
            overrides: p.overrides ?? {},
          }),
        });
        if (response.ok) {
          const payload = await response.json() as { profile?: AgentProfile };
          if (payload.profile) {
            setProfiles(current => [...current, payload.profile!]);
            imported++;
          }
        }
      }
      if (imported === 0) setImportError(t('errors.importProfilesNone'));
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : t('errors.importProfiles'));
    }
  };

  const testProfile = async (profile: AgentProfile) => {
    if (!testPrompt.trim()) return;
    setTestingProfileId(profile.id);
    setTestResult({ output: '', exitCode: null, status: 'running' });
    try {
      // Use the profile's base agent to execute a simple test in a temp workspace
      const response = await fetch(`/api/runtime/probe/${encodeURIComponent(profile.baseAgentId)}`);
      const payload = await response.json() as { probe?: Record<string, unknown>; error?: string };
      if (!response.ok) throw new Error(payload.error ?? t('errors.testProfile'));
      setTestResult({
        output: JSON.stringify(payload.probe, null, 2),
        exitCode: 0,
        status: 'done',
      });
    } catch (cause) {
      setTestResult({
        output: cause instanceof Error ? cause.message : t('errors.testFailed'),
        exitCode: null,
        status: 'error',
      });
    } finally {
      setTestingProfileId(null);
    }
  };

  const probeAgent = async (agent: AgentDescriptor) => {
    if (!agent.detected || probingAgentId === agent.id) return;
    setSelectedAgentId(agent.id);
    setProbingAgentId(agent.id);
    try {
      const response = await fetch(`/api/runtime/probe/${encodeURIComponent(agent.id)}`);
      const payload = await response.json() as { probe?: Omit<AgentCapabilityProbe, 'adapterStatus'>; adapterStatus?: AgentCapabilityProbe['adapterStatus']; error?: string };
      if (!response.ok || !payload.probe) throw new Error(payload.error ?? t('errors.probeAgent'));
      setAgentProbes(current => ({ ...current, [agent.id]: { ...payload.probe!, adapterStatus: payload.adapterStatus ?? 'unsupported' } }));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.probeAgent'));
    } finally {
      setProbingAgentId(null);
    }
  };

  const addCustomAgent = async () => {
    if (customAgentName.trim().length < 1 || customAgentCommand.trim().length < 1) {
      setError(t('errors.customAgentRequired'));
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
      if (!response.ok || !payload.agent) throw new Error(payload.error ?? t('errors.registerCustomAgent'));
      await loadAgents();
      setSelectedAgentId(payload.agent.id);
      setCustomAgentName('');
      setCustomAgentCommand('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.registerCustomAgent'));
    } finally {
      setSavingAgent(false);
    }
  };

  // An unreachable daemon fails every loader at once, and they all write the same `error` state, so
  // whichever settles last decides the message. Probing /api/health separately keeps the real cause
  // from being overwritten by a narrower one, and gives the sidebar indicator a fact to report.
  const checkDaemon = async () => {
    try {
      const response = await fetch('/api/health');
      const payload = response.ok ? await response.json() as { status?: string } : null;
      setDaemonOnline(payload?.status === 'ok');
    } catch {
      setDaemonOnline(false);
    }
  };

  const loadCredentials = async () => {
    // Best-effort: the backend status line must not block the credentials list, so a
    // failed /api/credentials/backend probe (e.g. older daemon) is silently ignored.
    void fetch('/api/credentials/backend')
      .then(async response => { if (response.ok) setCredentialBackend(await response.json() as CredentialBackendInfo); })
      .catch(() => setCredentialBackend(null));
    try {
      const response = await fetch('/api/credentials');
      if (!response.ok) throw new Error(t('errors.loadCredentials'));
      const payload = await response.json() as { meta: CredentialMeta };
      setCredentialMeta(payload.meta);
      if (payload.meta.keys.length === 0 && !guideMode) setGuideMode(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadCredentials'));
    }
  };

  const verifyAllCredentials = async () => {
    setVerifying(true);
    try {
      const response = await fetch('/api/credentials/verify', { method: 'POST' });
      if (!response.ok) throw new Error(t('errors.verifyCredentials'));
      const payload = await response.json() as { results: CredentialVerifyResult[] };
      setVerifyResults(payload.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.verifyCredentials'));
    } finally {
      setVerifying(false);
    }
  };

  const addCustomKey = async () => {
    const key = newCustomKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const value = newCustomValue.trim();
    if (!key || !value) { setError(t('errors.customKeyRequired')); return; }
    if (credentialMeta?.keys.includes(key)) { setError(t('errors.customKeyExists', { key })); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? t('errors.saveCustomKey'));
      setCredentialMeta(payload.meta ?? null);
      setNewCustomKey('');
      setNewCustomValue('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.saveCustomKey'));
    } finally {
      setSavingCredentials(false);
    }
  };

  const saveSupabaseManual = async () => {
    const entries = Object.entries(supabaseInputs).filter(([, v]) => (v as string).trim().length > 0);
    if (entries.length === 0) { setError(t('errors.supabaseUrlRequired')); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]))),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? t('errors.saveSupabase'));
      setCredentialMeta(payload.meta ?? null);
      setSupabaseInputs({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.saveSupabase'));
    } finally {
      setSavingCredentials(false);
    }
  };

  const saveCredentialValues = async () => {
    const entries = Object.entries(credentialInputs).filter(([, value]) => value.trim().length > 0);
    if (entries.length === 0) { setError(t('errors.tokenRequired')); return; }
    setSavingCredentials(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]))),
      });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? t('errors.saveCredentials'));
      setCredentialMeta(payload.meta ?? null);
      setCredentialInputs({});
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.saveCredentials'));
    } finally {
      setSavingCredentials(false);
    }
  };

  const deleteCredential = async (key: string) => {
    if (!window.confirm(t('errors.deleteCredentialConfirm', { key }))) return;
    try {
      const response = await fetch(`/api/credentials/${key}`, { method: 'DELETE' });
      const payload = await response.json() as { saved?: boolean; meta?: CredentialMeta; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error ?? t('errors.deleteCredential'));
      setCredentialMeta(payload.meta ?? null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.deleteCredential'));
    }
  };

  const loadProjectResources = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/resources`);
      if (!response.ok) throw new Error(t('errors.loadProjectResources'));
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
      if (!response.ok) throw new Error(t('errors.regenerateEnv'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.regenerateEnv'));
    } finally {
      setRegeneratingEnv(false);
    }
  };

  const startNewProject = () => {
    setSelected(null);
    setView({ kind: 'project', projectId: null as unknown as string, tab: 'blueprint' });
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
      if (!response.ok) throw new Error(t('errors.runPreflight'));
      setPreflight(await response.json() as ConnectorPreflightReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.runPreflight'));
    } finally {
      setCheckingPreflight(false);
    }
  };

  const discoverAccounts = async () => {
    setDiscoveringAccounts(true);
    try {
      const response = await fetch('/api/connectors/discovery');
      if (!response.ok) throw new Error(t('errors.discoverIdentities'));
      setAccountDiscovery(await response.json() as AccountDiscoveryReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.discoverIdentities'));
    } finally {
      setDiscoveringAccounts(false);
    }
  };

  const approveBaseline = async () => {
    if (!selected || !baselinePlan?.readyForApproval || baselineApproval) return;
    const approvedBy = recordApproverLocal();
    if (!approvedBy) {
      setError(t('errors.baselineApproverRequired'));
      return;
    }
    const confirmed = window.confirm(t('confirmations.approveBaseline', { approvedBy }));
    if (!confirmed) return;
    setApprovingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/baseline-plan/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: baselinePlan.blueprintRevision, confirmation: CONFIRMATIONS.APPROVE_BASELINE, approvedBy }),
      });
      const payload = await response.json() as { approval?: BaselineApproval; error?: string };
      if (!response.ok || !payload.approval) throw new Error(payload.error ?? t('errors.baselineApproverRequired'));
      setBaselineApproval(payload.approval);
      setActivity(current => [{ id: crypto.randomUUID(), text: t('activity.baselineApprovalRecorded'), time: t('activity.now') }, ...current].slice(0, 5));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.baselineApproverRequired'));
    } finally {
      setApprovingBaseline(false);
    }
  };

  const applyBaseline = async () => {
    if (!selected || !baselinePlan?.readyForApproval || !baselineApproval || applyingBaseline) return;
    const confirmed = window.confirm(t('confirmations.runApplySimulator'));
    if (!confirmed) return;
    setApplyingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: baselinePlan.blueprintRevision, confirmation: CONFIRMATIONS.APPLY_BASELINE }),
      });
      const payload = await response.json() as { run?: ApplyRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? t('errors.loadApplyRun'));
      setApplyRun(payload.run);
      void loadDependencyReadiness(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadApplyRun'));
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
        body: JSON.stringify({ confirmation: CONFIRMATIONS.RETRY_APPLY }),
      });
      const payload = await response.json() as { run?: ApplyRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? t('errors.loadApplyRun'));
      setApplyRun(payload.run);
      void loadDependencyReadiness(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadApplyRun'));
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
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, confirmation: CONFIRMATIONS.RUN_QUALITY_GATE }),
      });
      const payload = await response.json() as { result?: QualityGateResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? t('errors.loadQualityGate'));
      setQualityGateResult(payload.result);
      setError(response.ok ? '' : t('qualityGate.failed', { exitCode: payload.result.exitCode }));
      await loadDependencyReadiness(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.loadQualityGate'));
    } finally {
      setApplyingBaseline(false);
    }
  };

  const installDependencies = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || dependencyReadiness?.status !== 'missing-dependencies' || installingDependencies) return;
    if (!window.confirm(t('confirmations.runNpmInstall'))) return;
    setInstallingDependencies(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/dependencies/install`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, confirmation: CONFIRMATIONS.INSTALL_DEPENDENCIES }),
      });
      const payload = await response.json() as { result?: DependencyInstallResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? t('errors.installDependencies'));
      await loadDependencyReadiness(selected.id);
      setError(response.ok ? '' : t('qualityGate.dependencyInstallFailed', { exitCode: payload.result.exitCode }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.installDependencies'));
    } finally {
      setInstallingDependencies(false);
    }
  };

  const deployPreview = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || deployingPreview) return;
    if (!/^[a-z0-9-]+$/.test(previewBranch)) {
      setError(t('preview.branchValidation'));
      return;
    }
    setDeployingPreview(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${selected.id}/preview/deploy`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.DEPLOY_PREVIEW, previewBranch }),
      });
      const payload = await response.json() as { result?: PreviewDeploymentResult; error?: string };
      if (!payload.result) throw new Error(payload.error ?? t('errors.deployPreview'));
      setPreviewResult(payload.result);
      if (payload.result.status !== 'completed') setError(t('preview.deploymentStatus', { status: payload.result.status }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.deployPreview'));
    } finally {
      setDeployingPreview(false);
    }
  };

  const cleanupPreview = async () => {
    if (!selected || !previewResult?.cleanupRequired) return;
    if (!window.confirm(t('confirmations.deletePreviewProjects'))) return;
    setDeployingPreview(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/preview/cleanup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.CLEANUP_PREVIEW, vercelProject: previewResult.cleanupRequired.vercel, cloudflareProject: previewResult.cleanupRequired.cloudflare }),
      });
      const payload = await response.json() as { cleanup?: { vercel: boolean; cloudflare: boolean; errors: { provider: string; project: string; detail: string }[] }; error?: string };
      if (!payload.cleanup) throw new Error(payload.error ?? t('errors.cleanupPreview'));
      setPreviewResult(null);
      if (payload.cleanup.errors.length > 0) setError(t('errors.cleanupPartial', { providers: payload.cleanup.errors.map(e => e.provider).join(', ') }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.cleanupPreview'));
    } finally {
      setDeployingPreview(false);
    }
  };

  const createFeatureTask = async () => {
    if (!selected || !applyRun || applyRun.status !== 'completed' || savingFeatureTask) return;
    const acceptanceCriteria = featureCriteria.split('\n').map(value => value.trim()).filter(Boolean);
    if (featureTitle.trim().length < 3 || featureObjective.trim().length < 10 || acceptanceCriteria.length === 0) {
      setError(t('errors.featureTaskValidation'));
      return;
    }
    setSavingFeatureTask(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/feature-task`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: applyRun.blueprintRevision, title: featureTitle, objective: featureObjective, acceptanceCriteria }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? t('errors.createFeatureTask'));
      setFeatureTask(payload.task);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.createFeatureTask'));
    } finally {
      setSavingFeatureTask(false);
    }
  };

  const approveFeatureTask = async () => {
    if (!selected || !featureTask || featureTask.status !== 'draft' || savingFeatureTask) return;
    const approvedBy = recordApproverLocal();
    if (!approvedBy) {
      setError(t('errors.featureTaskApproverRequired'));
      return;
    }
    if (!window.confirm(t('confirmations.approveTask', { approvedBy }))) return;
    setSavingFeatureTask(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/feature-task/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: featureTask.blueprintRevision, confirmation: CONFIRMATIONS.APPROVE_FEATURE_TASK, approvedBy }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? t('errors.approveFeatureTask'));
      setFeatureTask(payload.task);
      void loadRuntimePlan(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.approveFeatureTask'));
    } finally {
      setSavingFeatureTask(false);
    }
  };

  const executePipeline = async () => {
    if (!selected || !featureTask || !featureTask.pipeline || featureTask.status !== 'approved' || savingFeatureTask) return;
    if (!window.confirm('Execute the pipeline? This will run all steps sequentially.')) return;
    setSavingFeatureTask(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/pipeline/execute`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: featureTask.blueprintRevision }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? 'Unable to execute pipeline.');
      setFeatureTask(payload.task);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to execute pipeline.');
    } finally {
      setSavingFeatureTask(false);
    }
  };

  const startEditPipeline = () => {
    if (!featureTask?.pipeline) {
      setPipelineDraft([{ id: crypto.randomUUID(), name: 'Step 1', profileId: '', prompt: '' }]);
    } else {
      setPipelineDraft(featureTask.pipeline.steps.map(s => ({ id: s.id, name: s.name, profileId: s.profileId, prompt: s.prompt })));
    }
    setEditingPipeline(true);
  };

  const addPipelineStep = () => {
    setPipelineDraft(draft => [...draft, { id: crypto.randomUUID(), name: `Step ${draft.length + 1}`, profileId: '', prompt: '' }]);
  };

  const removePipelineStep = (id: string) => {
    setPipelineDraft(draft => draft.filter(s => s.id !== id));
  };

  const updatePipelineStep = (id: string, field: 'name' | 'profileId' | 'prompt', value: string) => {
    setPipelineDraft(draft => draft.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const savePipeline = async () => {
    if (!selected || !featureTask) return;
    if (pipelineDraft.length === 0) { setError('Pipeline must have at least one step.'); return; }
    if (pipelineDraft.some(s => !s.name.trim() || !s.profileId)) { setError('All steps must have a name and selected profile.'); return; }
    setSavingPipeline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/pipeline`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ steps: pipelineDraft.map(s => ({ id: s.id, name: s.name, profileId: s.profileId, prompt: s.prompt })) }),
      });
      const payload = await response.json() as { task?: FeatureTask; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? 'Unable to save pipeline.');
      setFeatureTask(payload.task);
      setEditingPipeline(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save pipeline.');
    } finally {
      setSavingPipeline(false);
    }
  };

  const prepareRuntime = async () => {
    if (!selected || !featureTask || featureTask.status !== 'approved' || preparingRuntime) return;
    if (!window.confirm(t('confirmations.prepareRuntimeDryRun'))) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: CONFIRMATIONS.PREPARE_RUNTIME_RUN, agentId: selectedAgentId }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? t('errors.prepareRuntime'));
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.prepareRuntime'));
    } finally {
      setPreparingRuntime(false);
    }
  };

  const cancelRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'planned' || preparingRuntime) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: CONFIRMATIONS.CANCEL_RUNTIME_RUN }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? t('errors.cancelRuntime'));
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.cancelRuntime'));
    } finally {
      setPreparingRuntime(false);
    }
  };

  const executeRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'planned' || preparingRuntime) return;
    if (!window.confirm(t('confirmations.startCodex'))) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/execute`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: CONFIRMATIONS.EXECUTE_RUNTIME_RUN }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!payload.run) throw new Error(payload.error ?? t('errors.executeRuntime'));
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError(response.ok ? '' : t('runtime.executionFailed', { exitCode: payload.run.result?.exitCode ?? 'none' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.executeRuntime'));
    } finally {
      setPreparingRuntime(false);
    }
  };

  const retryRuntime = async () => {
    if (!selected || !runtimeRun || runtimeRun.status !== 'failed' || preparingRuntime) return;
    if (!window.confirm(t('confirmations.retryCodex'))) return;
    setPreparingRuntime(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/runtime/retry`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: CONFIRMATIONS.RETRY_RUNTIME_RUN }),
      });
      const payload = await response.json() as { run?: RuntimeRun; error?: string };
      if (!payload.run) throw new Error(payload.error ?? t('errors.retryRuntime'));
      setRuntimeRun(payload.run);
      await loadGitEvidence(selected.id);
      setError(response.ok ? '' : t('runtime.retryFailed', { exitCode: payload.run.result?.exitCode ?? 'none' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.retryRuntime'));
    } finally {
      setPreparingRuntime(false);
    }
  };

  const submitAcceptance = async () => {
    if (!selected || !featureTask || featureTask.status !== 'approved' || !runtimeRun || submittingAcceptance || acceptance?.status === 'approved') return;
    if (acceptanceSummary.trim().length < 10) { setError(t('errors.acceptanceSummaryRequired')); return; }
    setSubmittingAcceptance(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/acceptance`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: acceptanceSummary, criteriaConfirmed }),
      });
      const payload = await response.json() as { acceptance?: AcceptanceRecord; error?: string };
      if (!payload.acceptance) throw new Error(payload.error ?? t('errors.submitAcceptance'));
      setAcceptance(payload.acceptance);
      await loadFinalDeliveryReport(selected.id);
      setError(response.ok ? '' : t('errors.acceptanceBlocked'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.submitAcceptance'));
    } finally {
      setSubmittingAcceptance(false);
    }
  };

  const approveDelivery = async () => {
    if (!selected || !acceptance || acceptance.status !== 'ready' || submittingAcceptance) return;
    const approvedBy = recordApproverLocal();
    if (!approvedBy) {
      setError(t('errors.acceptanceApproverRequired'));
      return;
    }
    if (!window.confirm(t('confirmations.approveDeliveryEvidence', { approvedBy }))) return;
    setSubmittingAcceptance(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/acceptance/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: CONFIRMATIONS.APPROVE_DELIVERY, approvedBy }),
      });
      const payload = await response.json() as { acceptance?: AcceptanceRecord; error?: string };
      if (!response.ok || !payload.acceptance) throw new Error(payload.error ?? t('errors.approveDelivery'));
      setAcceptance(payload.acceptance);
      await loadFinalDeliveryReport(selected.id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.approveDelivery'));
    } finally {
      setSubmittingAcceptance(false);
    }
  };

  const applyFakeProviders = async () => {
    if (!selected || !baselineApproval || applyingFakeProviders) return;
    const confirmed = window.confirm(t('confirmations.runFakeProviderSimulation'));
    if (!confirmed) return;
    setApplyingFakeProviders(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/provider-plan/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: CONFIRMATIONS.APPLY_FAKE_PROVIDERS }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? t('errors.applyFakeProviders'));
      await verifyProviders();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.applyFakeProviders'));
    } finally {
      setApplyingFakeProviders(false);
    }
  };

  const verifyProviders = async () => {
    if (!selected || verifyingProviders) return;
    setVerifyingProviders(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/provider-plan/verify`);
      if (!response.ok) throw new Error(t('errors.verifyProviderSimulation'));
      const payload = await response.json() as { verification: ProviderVerification[]; deliveryReport: string; unifiedDeliveryReport: string };
      setProviderVerification(payload.verification);
      setProviderReport(payload.unifiedDeliveryReport);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.verifyProviderSimulation'));
    } finally {
      setVerifyingProviders(false);
    }
  };

  useEffect(() => {
    void checkDaemon();
    void loadProjects();
    void loadAgents();
    void loadProfiles();
    void loadCredentials();
    const source = new EventSource('/events');
    const onEvent = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { type: string; projectId: string; projectName: string; occurredAt: string };
      setActivity(current => [
        { id: crypto.randomUUID(), text: `${payload.type === 'blueprint.revised' ? t('activity.blueprintRevised') : payload.type === 'baseline.approved' ? t('activity.baselineApproved') : payload.type === 'apply.completed' ? t('activity.applyCompleted') : payload.type === 'apply.failed' ? t('activity.applyFailed') : t('activity.projectCreated')}: ${payload.projectName}`, time: formatDate(payload.occurredAt, locale) },
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
  }, [selected?.id, locale]);

  const setAnswer = <Key extends keyof BlueprintAnswers>(key: Key, value: BlueprintAnswers[Key]) => {
    setAnswers(current => ({ ...current, [key]: value }));
  };

  const ownershipFields = useMemo(() => {
    const providers = baselineProvidersFor(answers.productType);
    return ([
      ['github', { id: 'github-owner', labelKey: 'blueprint.githubOwner', answerKey: 'githubOwner' }],
      ['supabase', { id: 'supabase-organization', labelKey: 'blueprint.supabaseOrganization', answerKey: 'supabaseOrganization' }],
      ['vercel', { id: 'vercel-team', labelKey: 'blueprint.vercelTeam', answerKey: 'vercelTeam' }],
      ['cloudflare', { id: 'cloudflare-account', labelKey: 'blueprint.cloudflareAccount', answerKey: 'cloudflareAccount' }],
    ] as const).filter(([provider]) => providers.includes(provider)).map(([, field]) => field);
  }, [answers.productType]);

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
      setError(t('errors.projectNameRequired'));
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
      if (!response.ok || !payload.project) throw new Error(payload.error ?? t('errors.saveBlueprint'));
      setSelected(payload.project);
      setName(payload.project.name);
      setAnswers(answersFromBlueprint(payload.project.blueprint));
      await loadDryRun(payload.project.id);
      await loadBaselinePlan(payload.project.id);
      await loadApplyRun(payload.project.id);
      await loadProviderPlan(payload.project.id);
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.saveBlueprint'));
    } finally {
      setSaving(false);
    }
  }

  async function exportBlueprint() {
    if (!selected) return;
    try {
      const response = await fetch(`/api/projects/${selected.id}/blueprint/export`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Export failed');
      // Download as JSON file
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected.name.replace(/\s+/g, '-').toLowerCase()}-blueprint-r${selected.blueprint.metadata.revision}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed');
    }
  }

  async function importBlueprint(file: File) {
    if (!selected) return;
    setImportingBlueprint(true);
    setBlueprintImportResult(null);
    try {
      const text = await file.text();
      const blueprint = JSON.parse(text);
      const response = await fetch(`/api/projects/${selected.id}/blueprint/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprint }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Import failed');
      setBlueprintImportResult(`Imported as revision ${payload.revision ?? 'new'}. Reloading...`);
      await loadProjects();
      if (selected) {
        await selectProject(selected.id);
      }
      setTimeout(() => setBlueprintImportResult(null), 5000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed');
    } finally {
      setImportingBlueprint(false);
    }
  }

  async function loadBlueprintDiff() {
    if (!selected) return;
    setLoadingDiff(true);
    setShowDiff(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/blueprint/diff`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Diff failed');
      setBlueprintDiff({ added: payload.added ?? [], removed: payload.removed ?? [], modified: payload.modified ?? [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Diff failed');
      setBlueprintDiff(null);
    } finally {
      setLoadingDiff(false);
    }
  }

  const isProfessional = answers.mode === 'professional';

  const credentialsPanel = (
    <section className="credential-panel" id="credentials">
      <div className="panel-title"><div><p className="eyebrow">{t('common.localOnly')}</p><h2>{t('credentials.title')}</h2></div><KeyRound size={19} aria-hidden="true" /></div>
      <CredentialBackendStatus backend={credentialBackend} />

      {guideMode && credentialMeta?.keys.length === 0 && (
        <div className="credential-guide">
          <div className="guide-progress">
            <span>{t('credentials.step', { current: guideStep + 1, total: providerFields.length })}</span>
            <button className="guide-skip-button" type="button" onClick={() => setGuideMode(false)}>{t('credentials.skipGuide')}</button>
          </div>
          {providerFields.map((field, index) => (
            <div className={`guide-step ${index === guideStep ? 'active' : index < guideStep ? 'done' : ''}`} key={field.key}>
              <div className="guide-step-header">
                <strong>{field.label}</strong>
                {index < guideStep && credentialInputs[field.key] ? <span className="verify-status valid">{t('common.filled')}</span> : null}
              </div>
              {index === guideStep && <>
                <small>{field.hint}</small>
                <a href={field.tutorial} target="_blank" rel="noopener noreferrer">{t('credentials.howToGetToken')}</a>
                <input type="password" className="credential-input" value={credentialInputs[field.key] ?? ''} onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))} placeholder={`${t('credentials.paste')} ${field.label}`} />
                <div className="guide-step-actions">
                  {guideStep > 0 && <button className="secondary-button" type="button" onClick={() => setGuideStep(guideStep - 1)}>{t('common.back')}</button>}
                  {guideStep < providerFields.length - 1
                    ? <button className="primary-button" type="button" onClick={() => setGuideStep(guideStep + 1)}>{t('common.next')}</button>
                    : <button className="primary-button" type="button" onClick={() => { setGuideMode(false); void saveCredentialValues(); }}>{t('credentials.saveAll')}</button>}
                </div>
              </>}
            </div>
          ))}
        </div>
      )}

      {!guideMode && <>
        <div className="credential-list">
          {providerFields.map(field => {
            const connected = credentialMeta?.keys.includes(field.key) ?? false;
            const verifyResult = verifyResults.find(r => r.providerId === field.providerId);
            return (
              <article className="credential-item" key={field.key}>
                <div className="credential-header">
                  <strong>{field.label}</strong>
                  <span className={`credential-status ${connected ? 'connected' : 'missing'}`}>{connected ? t('common.connected') : t('common.notSet')}</span>
                  {verifyResult && <span className={`verify-status ${verifyResult.status}`}>{verifyResult.status === 'valid' ? t('common.valid') : verifyResult.status === 'invalid' ? t('common.invalid') : t('common.notApplicable')}</span>}
                </div>
                <small className="credential-hint">{field.hint}</small>
                <a className="credential-tutorial" href={field.tutorial} target="_blank" rel="noopener noreferrer">{t('credentials.howToGetToken')}</a>
                {connected ? (
                  <button className="quiet-button credential-delete" type="button" onClick={() => void deleteCredential(field.key)}>{t('common.delete')}</button>
                ) : (
                  <input
                    type="password"
                    className="credential-input"
                    value={credentialInputs[field.key] ?? ''}
                    onChange={event => setCredentialInputs(current => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={`${t('credentials.paste')} ${field.label}`}
                  />
                )}
              </article>
            );
          })}
        </div>
        <div className="credential-actions-row">
          <button className="primary-button" type="button" onClick={() => void saveCredentialValues()} disabled={savingCredentials}>
            {savingCredentials ? t('credentials.saving') : t('credentials.saveToLocal')}
            <KeyRound size={15} aria-hidden="true" />
          </button>
          <button className="secondary-button" type="button" onClick={() => void verifyAllCredentials()} disabled={verifying}>
            {verifying ? t('credentials.verifying') : t('credentials.verifyCredentials')}
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
          <div className="section-heading"><div><p className="eyebrow">{t('credentials.manualSetup')}</p><h3>{t('credentials.supabaseConfiguration')}</h3></div></div>
          <p className="form-note">{t('credentials.supabaseDescription')}</p>
          <ol className="supabase-steps">
            <li>{t('credentials.supabaseStep1', { link: 'Supabase Dashboard' })} <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard</a></li>
            <li>{t('credentials.supabaseStep2')}</li>
            <li>{t('credentials.supabaseStep4')}</li>
            <li>{t('credentials.supabaseStep3')}</li>
          </ol>
          <div className="supabase-inputs">
            <label htmlFor="supabase-url">{t('credentials.projectUrl')}</label>
            <input id="supabase-url" className="credential-input" value={supabaseInputs.SUPABASE_URL} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_URL: event.target.value }))} placeholder={t('credentials.urlPlaceholder')} />
            <label htmlFor="supabase-anon">{t('credentials.anonPublicKey')}</label>
            <input id="supabase-anon" className="credential-input" value={supabaseInputs.SUPABASE_ANON_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_ANON_KEY: event.target.value }))} placeholder={t('credentials.keyPlaceholder')} />
            <label htmlFor="supabase-service">{t('credentials.serviceRoleKey')}</label>
            <input id="supabase-service" className="credential-input" value={supabaseInputs.SUPABASE_SERVICE_ROLE_KEY} onChange={event => setSupabaseInputs(current => ({ ...current, SUPABASE_SERVICE_ROLE_KEY: event.target.value }))} placeholder={t('credentials.keyPlaceholder')} />
            <button className="secondary-button" type="button" onClick={() => void saveSupabaseManual()} disabled={savingCredentials}>{savingCredentials ? t('credentials.saving') : t('credentials.saveSupabaseConfig')}<KeyRound size={14} aria-hidden="true" /></button>
          </div>
        </div>

        {/* Custom API Keys */}
        <div className="custom-key-section">
          <div className="section-heading"><div><p className="eyebrow">{t('credentials.thirdParty')}</p><h3>{t('credentials.customApiKeys')}</h3></div></div>
          {credentialMeta?.keys.filter(key => !providerFields.some(f => f.key === key)).map(key => (
            <article className="credential-item" key={key}>
              <div className="credential-header">
                <strong>{key}</strong>
                <span className="credential-status connected">{t('credentials.configured')}</span>
              </div>
              <button className="quiet-button credential-delete" type="button" onClick={() => void deleteCredential(key)}>{t('common.delete')}</button>
            </article>
          ))}
          <div className="custom-key-form">
            <label htmlFor="custom-key-name">{t('credentials.keyNameLabel')}</label>
            <input id="custom-key-name" value={newCustomKey} onChange={event => setNewCustomKey(event.target.value)} placeholder={t('credentials.keyNamePlaceholder')} maxLength={60} />
            <label htmlFor="custom-key-value">{t('credentials.valueLabel')}</label>
            <input id="custom-key-value" type="password" value={newCustomValue} onChange={event => setNewCustomValue(event.target.value)} placeholder={t('credentials.valuePlaceholder')} maxLength={200} />
            <button className="secondary-button" type="button" onClick={() => void addCustomKey()} disabled={savingCredentials}>{savingCredentials ? t('credentials.saving') : t('credentials.addCustomKey')}<ArrowRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </>}

      {credentialMeta?.updatedAt && <small className="credential-updated">{t('credentials.lastUpdated', { date: formatDate(credentialMeta.updatedAt, locale) })}</small>}
      {selected && projectResources && (
        <div className="credential-resources">
          <p className="eyebrow">{t('credentials.projectResources')}</p>
          <div className="resource-list">
            {Object.entries(projectResources.providers).map(([providerId, state]) => (
              <article className="resource-item" key={providerId}>
                <strong>{providerId}</strong>
                <code>{'url' in state ? String(state.url) : 'projectId' in state ? String(state.projectId) : 'projectRef' in state ? String(state.projectRef) : 'created'}</code>
              </article>
            ))}
          </div>
          <button className="secondary-button" type="button" onClick={() => void regenerateEnv()} disabled={regeneratingEnv}>
            {regeneratingEnv ? t('credentials.regenerating') : t('credentials.regenerateEnv')}
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );

  const agentsPanel = (
    <section className="agent-catalog-panel" id="agents">
      <div className="panel-title"><div><p className="eyebrow">{t('agents.eyebrow')}</p><h2>{t('agents.title')}</h2></div><button className="icon-button" type="button" onClick={() => { void loadAgents(); void loadProfiles(); }} disabled={loadingAgents || loadingProfiles} aria-label={t('agents.refresh')} title={t('agents.refresh')}><RefreshCw size={17} /></button></div>
      <p className="form-note">{t('agents.formNote')}</p>
      {loadingAgents && agents.length === 0 ? <p className="empty-state">{t('agents.detecting')}</p> : agents.length === 0 ? <p className="empty-state">{t('agents.notFound')}</p> : <div className="agent-list">{agents.map(agent => (
        <button className={`agent-item ${selectedAgentId === agent.id ? 'selected' : ''}`} type="button" key={agent.id} onClick={() => void probeAgent(agent)} disabled={!agent.detected || probingAgentId !== null}>
          <div className="agent-info"><div className="agent-header"><strong>{agent.name}</strong><span className={`agent-source ${agent.source}`}>{agent.source === 'built-in' ? t('agents.builtIn') : t('agents.custom')}</span></div>{agent.version && <small className="agent-version">{agent.version}</small>}<small className="agent-detail">{probingAgentId === agent.id ? t('agents.runningProbe') : agent.detail}</small>{agent.capabilities.length > 0 && <div className="agent-caps">{agent.capabilities.map(cap => <span className="agent-cap" key={cap}>{cap}</span>)}</div>}{agentProbes[agent.id] && <div className="agent-caps"><span className="agent-cap">{agentProbes[agent.id].nonInteractive ? t('agents.nonInteractiveYes') : t('agents.nonInteractiveUnknown')}</span><span className="agent-cap">{agentProbes[agent.id].workspaceWrite ? t('agents.workspaceWriteYes') : t('agents.workspaceWriteNo')}</span><span className="agent-cap">{t('agents.adapter', { status: agentProbes[agent.id].adapterStatus })}</span></div>}<code className="agent-command">{agent.launchCommand}</code></div>
          <span className={`agent-status ${agent.detected ? 'detected' : 'missing'}`}>{agent.detected ? t('agents.detected') : t('agents.notDetected')}</span>
        </button>
      ))}</div>}

      {/* Agent Profiles */}
      {profiles.length > 0 && (
        <div className="agent-profiles-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
            <p className="form-note" style={{ fontWeight: 600, margin: 0 }}>{t('agents.profileCount', { count: profiles.length })}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="icon-button" onClick={exportAllProfiles} title={t('agents.exportAllTitle')} style={{ fontSize: '12px', padding: '4px 8px' }}>{t('agents.exportAll')}</button>
              <label className="icon-button" style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }} title={t('agents.importProfilesTitle')}>
                {t('agents.importProfiles')}
                <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void importProfiles(f); e.target.value = ''; }} />
              </label>
            </div>
          </div>
          {importError && <p style={{ color: 'var(--status-fail)', fontSize: '12px', marginTop: '4px' }}>{importError}</p>}
          <div className="agent-list">
            {profiles.map(profile => {
              const baseAgent = agents.find(a => a.id === profile.baseAgentId);
              const isSelected = selectedAgentId === profile.id;
              const isEditing = editingProfileId === profile.id;
              const isTesting = testingProfileId === profile.id;
              return (
                <div className={`agent-item ${isSelected ? 'selected' : ''}`} key={profile.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedAgentId(profile.id)}>
                  <div className="agent-info">
                    <div className="agent-header">
                      <strong>{profile.icon ? `${profile.icon} ` : ''}{profile.name}</strong>
                      <span className="agent-source profile">{t('agents.profileBadge')}</span>
                    </div>
                    <small className="agent-version">{t('agents.basedOn', { name: baseAgent?.name ?? profile.baseAgentId })}</small>
                    {profile.description && <small className="agent-detail">{profile.description}</small>}
                    <div className="agent-caps">
                      {profile.overrides.model && <span className="agent-cap">{t('agents.overrideModel', { model: profile.overrides.model })}</span>}
                      {profile.overrides.temperature !== undefined && <span className="agent-cap">{t('agents.overrideTemp', { temperature: profile.overrides.temperature })}</span>}
                      {profile.overrides.systemPrompt && <span className="agent-cap">{t('agents.overridePrompt')}</span>}
                      {profile.overrides.allowedTools && <span className="agent-cap">{t('agents.overrideTools', { count: profile.overrides.allowedTools.length })}</span>}
                      {profile.overrides.env && <span className="agent-cap">{t('agents.overrideEnv', { count: Object.keys(profile.overrides.env).length })}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <span className={`agent-status ${baseAgent?.detected ? 'detected' : 'missing'}`}>{baseAgent?.detected ? t('agents.baseReady') : t('agents.baseMissing')}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button type="button" className="icon-button" onClick={(e) => { e.stopPropagation(); openEditProfile(profile); }} title={t('agents.editProfileTitle')} style={{ padding: '2px 6px', fontSize: '12px' }}>✎</button>
                      <button type="button" className="icon-button" onClick={(e) => { e.stopPropagation(); exportProfile(profile); }} title={t('agents.exportProfileTitle')} style={{ padding: '2px 6px', fontSize: '12px' }}>↓</button>
                      <button type="button" className="icon-button" onClick={(e) => { e.stopPropagation(); setTestingProfileId(profile.id); setTestPrompt(''); setTestResult({ output: '', exitCode: null, status: 'idle' }); }} title={t('agents.testProfileTitle')} style={{ padding: '2px 6px', fontSize: '12px' }}>▶</button>
                      <button type="button" className="icon-button" onClick={(e) => { e.stopPropagation(); void deleteProfile(profile.id); }} title={t('agents.deleteProfileTitle')} style={{ padding: '2px 6px', fontSize: '12px' }}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Test Profile Modal */}
      {testingProfileId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => { setTestingProfileId(null); setTestResult({ output: '', exitCode: null, status: 'idle' }); }}>
          <div style={{ background: 'var(--bg, #fff)', padding: '24px', borderRadius: '8px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{t('agents.testProfileHeading', { name: profiles.find(p => p.id === testingProfileId)?.name ?? '' })}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-2)' }}>{t('agents.testProfileNote')}</p>
            <textarea value={testPrompt} onChange={e => setTestPrompt(e.target.value)} placeholder={t('agents.testPromptPlaceholder')} rows={3} style={{ width: '100%', marginBottom: '12px', padding: '8px' }} />
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button className="primary-button" type="button" onClick={() => { const p = profiles.find(pr => pr.id === testingProfileId); if (p) void testProfile(p); }} disabled={testResult.status === 'running' || !testPrompt.trim()}>{testResult.status === 'running' ? t('common.running') : t('agents.runTest')}</button>
              <button type="button" onClick={() => { setTestingProfileId(null); setTestResult({ output: '', exitCode: null, status: 'idle' }); }}>{t('common.close')}</button>
            </div>
            {testResult.status !== 'idle' && (
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  {t('agents.testResult', { result: testResult.status === 'done' ? t('agents.testResultSuccess') : testResult.status === 'error' ? t('agents.testResultError') : t('agents.testResultRunning') })}
                  {testResult.exitCode !== null && t('agents.testExitCode', { exitCode: testResult.exitCode })}
                </p>
                <pre style={{ background: 'var(--surface-muted)', padding: '12px', borderRadius: '4px', fontSize: '12px', overflow: 'auto', maxHeight: '300px' }}>{testResult.output}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <details className="agent-form-toggle" open={editingProfileId !== null}>
        <summary>{editingProfileId ? t('agents.editProfileHeading', { name: profiles.find(p => p.id === editingProfileId)?.name ?? '' }) : t('agents.createEditProfile')}</summary>
        <div className="agent-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="profile-name">{t('agents.profileName')}</label>
              <input id="profile-name" value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder={t('agents.profileNamePlaceholder')} maxLength={80} />
            </div>
            <div>
              <label htmlFor="profile-icon">{t('agents.profileIcon')}</label>
              <input id="profile-icon" value={profileForm.icon} onChange={e => setProfileForm(f => ({ ...f, icon: e.target.value }))} placeholder={t('agents.profileIconPlaceholder')} maxLength={10} />
            </div>
          </div>
          <label htmlFor="profile-description">{t('agents.profileDescription')}</label>
          <input id="profile-description" value={profileForm.description} onChange={e => setProfileForm(f => ({ ...f, description: e.target.value }))} placeholder={t('agents.profileDescriptionPlaceholder')} maxLength={200} />
          <label htmlFor="profile-base-agent">{t('agents.baseAgent')}</label>
          <select id="profile-base-agent" value={profileForm.baseAgentId} onChange={e => setProfileForm(f => ({ ...f, baseAgentId: e.target.value }))} disabled={editingProfileId !== null}>
            <option value="">{t('agents.selectBaseAgent')}</option>
            {agents.filter(a => a.detected).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {editingProfileId && <p style={{ fontSize: '12px', color: 'var(--text-2)' }}>{t('agents.baseAgentFixed')}</p>}
          <label htmlFor="profile-system-prompt">{t('agents.systemPrompt')}</label>
          <textarea id="profile-system-prompt" value={profileForm.systemPrompt} onChange={e => setProfileForm(f => ({ ...f, systemPrompt: e.target.value }))} placeholder={t('agents.systemPromptPlaceholder')} rows={3} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="profile-model">{t('agents.modelId')}</label>
              <input id="profile-model" value={profileForm.model} onChange={e => setProfileForm(f => ({ ...f, model: e.target.value }))} placeholder={t('agents.modelIdPlaceholder')} maxLength={200} />
            </div>
            <div>
              <label htmlFor="profile-temperature">{t('agents.temperature')}</label>
              <input id="profile-temperature" type="number" min="0" max="2" step="0.1" value={profileForm.temperature} onChange={e => setProfileForm(f => ({ ...f, temperature: e.target.value }))} placeholder={t('agents.temperaturePlaceholder')} />
            </div>
          </div>
          <label htmlFor="profile-allowed-tools">{t('agents.allowedTools')}</label>
          <input id="profile-allowed-tools" value={profileForm.allowedTools} onChange={e => setProfileForm(f => ({ ...f, allowedTools: e.target.value }))} placeholder={t('agents.allowedToolsPlaceholder')} />
          <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '-8px' }}>{t('agents.allowedToolsNote')}</p>
          <label>{t('agents.envVars')}</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input value={profileForm.envKey} onChange={e => setProfileForm(f => ({ ...f, envKey: e.target.value }))} placeholder={t('agents.envKeyPlaceholder')} style={{ flex: 1 }} />
            <input value={profileForm.envValue} onChange={e => setProfileForm(f => ({ ...f, envValue: e.target.value }))} placeholder={t('agents.envValuePlaceholder')} style={{ flex: 2 }} />
            <button type="button" onClick={() => { if (profileForm.envKey.trim()) { setProfileForm(f => ({ ...f, envPairs: [...f.envPairs, { key: f.envKey.trim(), value: f.envValue }], envKey: '', envValue: '' })); } }}>{t('agents.envAdd')}</button>
          </div>
          {profileForm.envPairs.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              {profileForm.envPairs.map((pair, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <code style={{ fontSize: '12px' }}>{pair.key}={pair.value}</code>
                  <button type="button" onClick={() => setProfileForm(f => ({ ...f, envPairs: f.envPairs.filter((_, j) => j !== i) }))} style={{ fontSize: '12px' }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="primary-button" type="button" onClick={() => editingProfileId ? void updateProfile() : void createProfile()} disabled={savingProfile || !profileForm.name.trim() || !profileForm.baseAgentId}>
              {savingProfile ? t('common.saving') : editingProfileId ? t('agents.updateProfile') : t('agents.createProfile')}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            {editingProfileId && <button type="button" onClick={resetProfileForm}>{t('common.cancel')}</button>}
          </div>
        </div>
      </details>
      <details className="agent-form-toggle">
        <summary>{t('agents.addCustomSummary')}</summary>
        <div className="agent-form">
          <label htmlFor="custom-agent-name">{t('agents.agentName')}</label>
          <input id="custom-agent-name" value={customAgentName} onChange={event => setCustomAgentName(event.target.value)} placeholder={t('agents.namePlaceholder')} maxLength={80} />
          <label htmlFor="custom-agent-command">{t('agents.launchCommand')}</label>
          <input id="custom-agent-command" value={customAgentCommand} onChange={event => setCustomAgentCommand(event.target.value)} placeholder={t('agents.commandPlaceholder')} maxLength={200} />
          <button className="primary-button" type="button" onClick={() => void addCustomAgent()} disabled={savingAgent}>{savingAgent ? t('agents.registering') : t('agents.register')}<ArrowRight size={15} aria-hidden="true" /></button>
        </div>
      </details>
    </section>
  );

  const activityPanel = (
    <section className="activity-panel" id="activity"><div className="panel-title"><h2>{t('activity.panelTitle')}</h2><Activity size={18} aria-hidden="true" /></div><ol>{activity.map(item => <li key={item.id}><span>{item.text}</span><time>{item.time}</time></li>)}</ol></section>
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => setView({ kind: 'dashboard' })} title={t('nav.projects')}>
          <img className="brand-mark" src="/favicon.svg" alt="" width={22} height={22} /><span>{t('common.brandName')}</span>
        </button>
        <nav aria-label="Studio navigation">
          <button className={`nav-item ${view.kind === 'dashboard' || view.kind === 'project' ? 'active' : ''}`} type="button" onClick={() => setView({ kind: 'dashboard' })}><FolderKanban size={18} aria-hidden="true" />{t('nav.projects')}</button>
          <button className={`nav-item ${view.kind === 'credentials' ? 'active' : ''}`} type="button" onClick={() => setView({ kind: 'credentials' })}><KeyRound size={18} aria-hidden="true" />{t('nav.credentials')}</button>
          <button className={`nav-item ${view.kind === 'agents' ? 'active' : ''}`} type="button" onClick={() => setView({ kind: 'agents' })}><CircleDot size={18} aria-hidden="true" />{t('nav.agents')}</button>
          <button className={`nav-item ${view.kind === 'activity' ? 'active' : ''}`} type="button" onClick={() => setView({ kind: 'activity' })}><Activity size={18} aria-hidden="true" />{t('nav.activity')}</button>
        </nav>
        <div className={`sidebar-note ${daemonOnline === false ? 'offline' : ''}`}><CircleDot size={14} aria-hidden="true" />{daemonOnline === null ? t('activity.localDaemonChecking') : daemonOnline ? t('activity.localDaemonConnected') : t('activity.localDaemonDisconnected')}</div>
      </aside>

      <section className="workspace" id="projects">
        <header className="topbar">
          <div>
            {view.kind === 'project' && selected ? (
              <div className="project-detail-title">
                <button className="icon-button back-button" type="button" onClick={() => setView({ kind: 'dashboard' })} aria-label={t('common.back')} title={t('common.back')}>
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <p className="eyebrow">{t('projects.detailEyebrow', { revision: selected.blueprint.metadata.revision })}</p>
                  <h1>{selected.name}</h1>
                  {/* The delivery state only existed in the list. Once inside a project there was no
                      label saying where the run stands, so the four tabs gave no hint about which one
                      had anything to do. */}
                  <span className="state project-state">{t(`projectState.${selected.state}` as KeyPath)}</span>
                </div>
              </div>
            ) : view.kind === 'credentials' ? (
              <div><p className="eyebrow">{t('common.localOnly')}</p><h1>{t('credentials.title')}</h1></div>
            ) : view.kind === 'agents' ? (
              <div><p className="eyebrow">{t('agents.eyebrow')}</p><h1>{t('agents.title')}</h1></div>
            ) : view.kind === 'activity' ? (
              <div><p className="eyebrow">{t('activity.eyebrow')}</p><h1>{t('activity.panelTitle')}</h1></div>
            ) : view.kind === 'dashboard' ? (
              <div><p className="eyebrow">{t('hero.eyebrow')}</p><h1>{t('hero.title')}</h1></div>
            ) : null}
          </div>
          <div className="topbar-actions">
            <div className="locale-switcher" role="group" aria-label={t('common.language')}>
              <button className={locale === 'en' ? 'active' : ''} type="button" onClick={() => setLocale('en')}>EN</button>
              <button className={locale === 'zh' ? 'active' : ''} type="button" onClick={() => setLocale('zh')}>中</button>
            </div>
            <button className="theme-switch" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            <button className="icon-button" type="button" onClick={() => void loadProjects()} aria-label={t('common.refresh')} title={t('common.refresh')}><RefreshCw size={18} /></button>
            {view.kind === 'project' && selected && (
              <>
                <button className="quiet-button" type="button" onClick={() => void exportBlueprint()} title="Export Blueprint as JSON">
                  Export
                </button>
                <label className="quiet-button" style={{ cursor: 'pointer' }} title="Import Blueprint from JSON">
                  Import
                  <input type="file" accept="application/json" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) void importBlueprint(file); e.target.value = ''; }} disabled={importingBlueprint} />
                </label>
                <button className="quiet-button" type="button" onClick={() => { if (showDiff) { setShowDiff(false); setBlueprintDiff(null); } else void loadBlueprintDiff(); }} title="Show diff with previous revision">
                  {showDiff ? 'Hide Diff' : 'Show Diff'}
                </button>
              </>
            )}
            {view.kind === 'dashboard' && (
              <button className="quiet-button" type="button" onClick={startNewProject}>
                {t('projects.newBlueprint')}
              </button>
            )}
          </div>
        </header>

        {/* The banner used to live inside Dashboard, which made it the only place any error could
            appear: a credentials failure surfaced on the home page, and a release failure was
            invisible until the user navigated back to it. Rendering it in the shell puts every
            message in the view that produced it. */}
        {(daemonOnline === false || error) && (
          <div className="error-panel" role="alert">
            {daemonOnline === false ? (
              <p className="error">{t('errors.daemonUnavailable')}</p>
            ) : (
              <FailureDisplay error={error} />
            )}
          </div>
        )}

        {view.kind === 'dashboard' && (
          <Dashboard
            projects={projects}
            selected={selected}
            loading={loading}
            onSelectProject={selectProject}
          />
        )}

        {view.kind === 'project' && (
        <div className="studio-grid project-detail-grid">
          <section className="project-area project-detail-main" aria-label={selected ? selected.name : t('projects.title')}>
            <nav className="detail-tabs" aria-label={t('projects.tabs')}>
              {(['blueprint', 'delivery', 'iteration', 'release'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={`detail-tab ${view.kind === 'project' && view.tab === tab ? 'active' : ''}`}
                  onClick={() => setView({ kind: 'project', projectId: view.kind === 'project' ? view.projectId : '', tab })}
                >
                  {t(`projects.detailTabs.${tab}` as KeyPath)}
                </button>
              ))}
            </nav>

            {view.kind === 'project' && view.tab === 'blueprint' && <>
            {showDiff && selected && <section className="diff-section" id="blueprint-diff">
              <div className="section-heading"><div><p className="eyebrow">Blueprint Diff</p><h2>Changes since previous revision</h2></div></div>
              {loadingDiff ? <p>Loading diff...</p> : blueprintDiff ? (
                <div className="diff-grid">
                  {blueprintDiff.added.length > 0 && <article className="diff-card added"><h3>Added ({blueprintDiff.added.length})</h3><ul>{blueprintDiff.added.map(path => <li key={path}><code>{path}</code></li>)}</ul></article>}
                  {blueprintDiff.removed.length > 0 && <article className="diff-card removed"><h3>Removed ({blueprintDiff.removed.length})</h3><ul>{blueprintDiff.removed.map(path => <li key={path}><code>{path}</code></li>)}</ul></article>}
                  {blueprintDiff.modified.length > 0 && <article className="diff-card modified"><h3>Modified ({blueprintDiff.modified.length})</h3><ul>{blueprintDiff.modified.map(path => <li key={path}><code>{path}</code></li>)}</ul></article>}
                  {blueprintDiff.added.length === 0 && blueprintDiff.removed.length === 0 && blueprintDiff.modified.length === 0 && <p>No changes since previous revision.</p>}
                </div>
              ) : <p>No diff available.</p>}
            </section>}
            {blueprintImportResult && <div className="import-result"><CheckCircle2 size={16} /> {blueprintImportResult}</div>}
            {selected && <section className="decision-section" id="decisions">
              <div className="section-heading"><div><p className="eyebrow">{t('decisions.eyebrowRevision', { revision: selected.blueprint.metadata.revision })}</p><h2>{t('decisions.title')}</h2></div><span className="mode-tag">{selected.blueprint.metadata.mode === 'beginner' ? t('blueprint.beginner') : t('blueprint.professional')}</span></div>
              <div className="decision-list">{decisions.map(decision => <article className="decision" key={decision.id}>
                <div><h3>{decision.title}</h3><p>{decision.value}</p><small>{decision.reason}</small></div><span className={`decision-mode ${decision.mode}`}>{decision.mode === 'auto' ? t('decisions.mode.auto') : decision.mode === 'ask' ? t('decisions.mode.ask') : t('decisions.mode.manual')}</span>
              </article>)}</div>
            </section>}

            {selected && dryRun && <section className="plan-section" id="standards">
              <div className="section-heading"><div><p className="eyebrow">{t('plan.eyebrow', { revision: dryRun.blueprintRevision })}</p><h2>{t('plan.title')}</h2><p>{dryRun.summary}</p></div><span className="dry-run-tag">{t('plan.noExternalWrites')}</span></div>
              <div className="plan-grid">
                <article className="plan-card"><h3>{t('plan.preparedAutomatically')}</h3><ol>{dryRun.automaticPreparation.map(step => <li key={step}>{step}</li>)}</ol></article>
                <article className="plan-card"><h3>{t('plan.requiredFromYou')}</h3><ol>{dryRun.manualActions.map(action => <li key={action.id}><strong>{action.title}</strong><span>{action.reason}</span><small>{t('plan.verify', { verification: action.verification })}</small></li>)}</ol></article>
              </div>
              <div className="artifact-heading"><div><h3>{t('plan.generatedPackage')}</h3><p>{t('common.previewOnly')}</p></div><button className="icon-button" type="button" onClick={() => void loadDryRun(selected.id)} aria-label={t('plan.refreshPlan')} title={t('plan.refreshPlan')}><RefreshCw size={17} /></button></div>
              <div className="artifact-list">{dryRun.artifacts.map(artifact => <button className={`artifact-button ${selectedArtifact?.id === artifact.id ? 'selected' : ''}`} type="button" key={artifact.id} onClick={() => setSelectedArtifactId(artifact.id)}><strong>{artifact.title}</strong><span>{artifact.path}</span></button>)}</div>
              {selectedArtifact && <article className="artifact-preview"><div><h3>{selectedArtifact.title}</h3><p>{selectedArtifact.path}</p></div><pre>{selectedArtifact.content}</pre></article>}
            </section>}
            </>}

            {view.kind === 'project' && view.tab === 'delivery' && <>
            {selected?.state === 'LOCAL_ACCEPTED' && <section className="evidence-section"><div className="section-heading"><div><p className="eyebrow">{t('evidence.eyebrow')}</p><h2>{t('evidence.openPullRequest')}</h2><p>{t('evidence.openPullRequestDescription')}</p></div><span className="dry-run-tag">{t('projectState.LOCAL_ACCEPTED')}</span></div><div className="evidence-form"><button className="primary-button" type="button" onClick={() => void openPullRequest()} disabled={recordingDeliveryEvidence}>{recordingDeliveryEvidence ? t('evidence.opening') : t('evidence.pushAndOpen')}<ArrowRight size={15} aria-hidden="true" /></button></div></section>}
            {selected?.state === 'PR_OPEN' && <section className="evidence-section"><div className="section-heading"><div><p className="eyebrow">{t('evidence.eyebrow')}</p><h2>{t('evidence.recordDualPreview')}</h2><p>{t('evidence.recordDualPreviewDescription')}</p></div><span className="dry-run-tag">{t('projectState.PR_OPEN')}</span></div><div className="evidence-form"><label htmlFor="preview-api-url">{t('evidence.apiPreviewUrl')}</label><input id="preview-api-url" type="url" value={previewApiUrl} onChange={event => setPreviewApiUrl(event.target.value)} placeholder={t('evidence.apiPreviewPlaceholder')} /><label htmlFor="preview-web-url">{t('evidence.webPreviewUrl')}</label><input id="preview-web-url" type="url" value={previewWebUrl} onChange={event => setPreviewWebUrl(event.target.value)} placeholder={t('evidence.webPreviewPlaceholder')} /><label htmlFor="preview-smoke-test">{t('evidence.smokeTestResult')}</label><textarea id="preview-smoke-test" value={previewSmokeTest} onChange={event => setPreviewSmokeTest(event.target.value)} placeholder={t('evidence.smokeTestPlaceholder')} /><button className="primary-button" type="button" onClick={() => void recordPreviewEvidence()} disabled={recordingDeliveryEvidence || !previewApiUrl.trim() || !previewWebUrl.trim() || !previewSmokeTest.trim()}>{recordingDeliveryEvidence ? t('evidence.recording') : t('evidence.recordPreviewEvidence')}<ArrowRight size={15} aria-hidden="true" /></button></div></section>}

            {(prEvidence || previewEvidence) && <section className="evidence-section evidence-records"><div className="section-heading"><div><p className="eyebrow">{t('evidence.recordedEvidence')}</p><h2>{t('evidence.deliveryEvidenceHistory')}</h2><p>{t('evidence.historyDescription')}</p></div><CheckCircle2 size={18} aria-hidden="true" /></div>{prEvidence && <article className="evidence-record"><strong>{t('evidence.pullRequest')}</strong><a href={prEvidence.url} target="_blank" rel="noreferrer">{prEvidence.url}</a><small>{prEvidence.checks.join(' · ')} · {formatDate(prEvidence.recordedAt, locale)}</small></article>}{previewEvidence && <article className="evidence-record"><strong>{t('evidence.dualPreview')}</strong><span>{t('evidence.api')}: {previewEvidence.apiUrl}</span><span>{t('evidence.web')}: {previewEvidence.webUrl}</span><small>{previewEvidence.smokeTest} · {formatDate(previewEvidence.recordedAt, locale)}</small></article>}</section>}

            {selected && baselinePlan && <section className="baseline-section">
              <div className="section-heading"><div><p className="eyebrow">{t('baseline.eyebrow', { revision: baselinePlan.blueprintRevision })}</p><h2>{t('decisions.baselineResources')}</h2><p>{baselinePlan.summary}</p></div><span className={`baseline-tag ${baselineApproval ? 'approved' : baselinePlan.readyForApproval ? 'ready' : 'blocked'}`}>{baselineApproval ? t('baseline.status.approved') : baselinePlan.readyForApproval ? t('baseline.status.ready') : t('baseline.status.blocked')}</span></div>
              <div className="baseline-list">{baselinePlan.resources.map(resource => <article className="baseline-resource" key={resource.id}>
                <div><h3>{resource.title}</h3><p>{resource.owner ?? t('baseline.notSelected')}</p><small>{resource.reason}</small></div><span className={`resource-status ${resource.status}`}>{resource.status === 'blocked' ? t('baseline.resourceStatus.blocked') : baselineApproval ? t('baseline.resourceStatus.approved') : t('baseline.resourceStatus.awaiting')}</span>
              </article>)}</div>
              {baselineApproval ? <div className="approval-record"><CheckCircle2 size={17} aria-hidden="true" /><div><strong>{t('baseline.approvalRecorded')}</strong><small>{t('baseline.approvalRecordedDetail', { revision: baselineApproval.blueprintRevision, approvedBy: baselineApproval.approvedBy, date: formatDate(baselineApproval.approvedAt, locale) })}</small></div></div> : baselinePlan.readyForApproval ? <div className="approval-action"><p>{t('decisions.approvalNote')}</p>{approverField('baseline-approver', t('baseline.whoApproves'))}<button className="primary-button" type="button" onClick={() => void approveBaseline()} disabled={approvingBaseline}>{approvingBaseline ? t('baseline.recordingApproval') : t('baseline.approvePlan')}<ShieldCheck size={16} aria-hidden="true" /></button></div> : null}
              {baselineApproval && !applyRun && <div className="approval-action"><p>{t('baseline.runSimulator')}</p><button className="primary-button" type="button" onClick={() => void applyBaseline()} disabled={applyingBaseline}>{applyingBaseline ? t('baseline.applyingLocally') : t('baseline.runLocalApply')}<ArrowRight size={16} aria-hidden="true" /></button></div>}
              {applyRun && <div className={`apply-run ${applyRun.status}`}><div className="apply-run-heading"><strong>{t('baseline.localApplyStatus', { status: applyRun.status })}</strong><small>{t('baseline.attemptOf', { attempt: applyRun.attempts, count: 3, workspacePath: applyRun.workspacePath ?? '' })}</small></div><ol>{applyRun.steps.map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{t(`stepStatus.${step.status}` as KeyPath)}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>{applyRun.status === 'failed' && applyRun.attempts < 3 && <button className="secondary-button retry-button" type="button" onClick={() => void retryApply()} disabled={applyingBaseline}>{applyingBaseline ? t('baseline.retrying') : t('baseline.retryLocalApply')}<RefreshCw size={15} aria-hidden="true" /></button>}{(applyRun.status === 'failed' || releasePlan?.workspace.usable === false) && <div className="workspace-recovery"><p>{releasePlan?.workspace.usable === false ? t('baseline.workspaceNotUsable', { reason: ([...releasePlan.workspace.missing, ...releasePlan.workspace.staleConfig].join(', ') || releasePlan.workspace.reason) ?? '' }) : t('baseline.retryInPlace')}</p><button className="secondary-button" type="button" onClick={() => void recoverWorkspace()} disabled={recoveringWorkspace}>{recoveringWorkspace ? t('baseline.recovering') : t('baseline.recoverWorkspace')}<RefreshCw size={15} aria-hidden="true" /></button></div>}</div>}
              {applyRun?.status === 'completed' && dependencyReadiness && <div className={`quality-gate ${dependencyReadiness.status}`}><div><p className="eyebrow">{t('qualityGate.eyebrow')}</p><h3>{qualityGateResult ? t('qualityGate.lastRun', { status: qualityGateResult.status }) : dependencyReadiness.status === 'ready' ? t('qualityGate.ready') : t('qualityGate.dependenciesRequired')}</h3><p>{dependencyReadiness.nextAction}</p></div>{dependencyReadiness.status === 'missing-dependencies' && <button className="secondary-button" type="button" onClick={() => void installDependencies()} disabled={installingDependencies}>{installingDependencies ? t('qualityGate.installing') : t('qualityGate.installDependencies')}<ArrowRight size={15} aria-hidden="true" /></button>}{dependencyReadiness.status === 'ready' && <button className="secondary-button" type="button" onClick={() => void runQualityGate()} disabled={applyingBaseline}>{applyingBaseline ? t('qualityGate.running') : t('qualityGate.runQualityGate')}<CheckCircle2 size={15} aria-hidden="true" /></button>}</div>}
              {applyRun?.status === 'completed' && qualityGateResult?.status === 'passed' && <div className="preview-deployment"><div className="runtime-heading"><div><p className="eyebrow">{t('preview.eyebrow')}</p><h3>{previewResult ? t('preview.previewStatus', { status: previewResult.status }) : t('preview.deployTitle')}</h3><p>{previewResult?.status === 'completed' ? t('preview.completedDescription', { apiUrl: previewResult.apiBaseUrl ?? '', pagesUrl: previewResult.pagesUrl ?? '' }) : previewResult?.status === 'failed' ? t('preview.failedDescription') : t('preview.defaultDescription')}</p></div></div>{!previewResult ? <div className="preview-deploy-form"><label htmlFor="preview-branch">{t('preview.branch')}</label><input id="preview-branch" value={previewBranch} onChange={event => setPreviewBranch(event.target.value)} placeholder={t('preview.branchPlaceholder')} pattern="[a-z0-9-]+" maxLength={100} /><button className="primary-button" type="button" onClick={() => void deployPreview()} disabled={deployingPreview}>{deployingPreview ? t('preview.deploying') : t('preview.deploy')}<ArrowRight size={15} aria-hidden="true" /></button></div> : <div className="preview-steps"><ol>{previewResult.steps.map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{t(`stepStatus.${step.status}` as KeyPath)}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>{previewResult.status === 'completed' && <div className="preview-urls"><span>{t('preview.api')} <a href={previewResult.apiBaseUrl} target="_blank" rel="noreferrer">{previewResult.apiBaseUrl}</a></span><span>{t('preview.pages')} <a href={previewResult.pagesUrl} target="_blank" rel="noreferrer">{previewResult.pagesUrl}</a></span><span>{t('preview.cors')} <code>{previewResult.corsOrigin}</code></span></div>}{previewResult.cleanupRequired && <button className="secondary-button" type="button" onClick={() => void cleanupPreview()} disabled={deployingPreview}>{deployingPreview ? t('preview.cleaningUp') : t('preview.cleanupProjects')}<RefreshCw size={15} aria-hidden="true" /></button>}</div>}</div>}
            </section>}
            </>}

            {view.kind === 'project' && view.tab === 'release' && selected && <>
              {releasePlan && <div className={`production-release ${selected.state.toLowerCase()}`}><div className="runtime-heading"><div><p className="eyebrow">{t('release.eyebrow')}</p><h3>{selected.state === 'DELIVERED' ? (releasePlan.manualDistribution ? t('release.distributed') : t('release.released')) : selected.state === 'AWAITING_APPROVAL' ? t('release.awaitingApproval') : selected.state === 'RELEASING' ? t('release.releasing') : t('release.requestTitle')}</h3><p>{releasePlan.manualDistribution ? t('release.manualDistributionNote') : t('release.productionOriginWithValue', { origin: releasePlan.corsOrigin ?? '' })} · {t('release.approvalIs', { approval: releasePlan.productionApproval })}</p></div></div>
                <ol className="release-steps">{(releaseRun?.steps ?? releasePlan.steps).map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{t(`stepStatus.${step.status}` as KeyPath)}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>
                {releasePlan.source
                  ? <p className="release-source">{t('release.releasingSource', { repository: releasePlan.source.repository, branch: releasePlan.source.branch, commit: releasePlan.source.acceptedCommit.slice(0, 7) })}</p>
                  : <p className="release-source blocked">{t('release.sourceBlocked', { reason: releasePlan.sourceReason ?? '' })}</p>}
                {(selected.state === 'PREVIEW_READY' || (Boolean(releasePlan.manualDistribution) && selected.state === 'PR_OPEN')) && <button className="primary-button" type="button" onClick={() => void requestRelease()} disabled={releaseBusy || !releasePlan.workspace.usable || !releasePlan.source}>{releaseBusy ? t('release.requesting') : t('release.requestTitle')}<ArrowRight size={15} aria-hidden="true" /></button>}
                {selected.state === 'AWAITING_APPROVAL' && <div className="release-approval">{approverField('release-approver', t('release.whoApproves'))}<label htmlFor="release-summary">{t('release.whatIsReleased')}</label><textarea id="release-summary" value={releaseSummary} onChange={event => setReleaseSummary(event.target.value)} placeholder={t('release.releaseSummaryPlaceholder')} maxLength={500} /><button className="primary-button" type="button" onClick={() => void approveRelease()} disabled={releaseBusy}>{releaseBusy ? t('release.releasingButton') : releasePlan.manualDistribution ? t('release.approveAndDistribute') : t('release.approveAndRelease')}<ShieldCheck size={15} aria-hidden="true" /></button></div>}
                {releaseRun?.status === 'failed' && <button className="secondary-button retry-button" type="button" onClick={() => void retryRelease()} disabled={releaseBusy || releaseRun.attempts >= 3}>{releaseBusy ? t('release.retrying') : releaseRun.attempts >= 3 ? t('release.retryLimitReached') : t('release.retryApprovedRelease')}<RefreshCw size={15} aria-hidden="true" /></button>}
                {releaseEvidence && <div className="release-evidence"><p>{t('release.approvedBy', { approvedBy: releaseEvidence.approvedBy, date: new Date(releaseEvidence.recordedAt).toLocaleString(), summary: releaseEvidence.approvalSummary })}</p>{releaseEvidence.distribution === 'manual' ? <div className="preview-urls"><span>{t('release.distributionManual')}</span></div> : <div className="preview-urls"><span>{t('release.api')} <a href={releaseEvidence.apiBaseUrl} target="_blank" rel="noreferrer">{releaseEvidence.apiBaseUrl}</a></span><span>{t('release.web')} <a href={releaseEvidence.webUrl} target="_blank" rel="noreferrer">{releaseEvidence.webUrl}</a></span><span>{t('evidence.cors')}: <code>{releaseEvidence.corsOrigin}</code></span></div>}<pre className="evidence-observations">{JSON.stringify(releaseEvidence.observations, null, 2)}</pre></div>}</div>}
            </>}

            {view.kind === 'project' && view.tab === 'iteration' && <>
              {applyRun?.status === 'completed' && <div className="feature-task"><div className="feature-task-heading"><div><p className="eyebrow">{t('featureTask.eyebrow')}</p><h3>{featureTask ? featureTask.title : t('featureTask.defineNext')}</h3><p>{featureTask ? t('featureTask.taskIs', { status: featureTask.status }) : t('featureTask.createTaskDescription')}</p></div>{featureTask && <span className={`baseline-tag ${featureTask.status === 'approved' ? 'approved' : 'ready'}`}>{t(`status.${featureTask.status}` as KeyPath)}</span>}</div>{!featureTask ? <div className="feature-task-form"><label htmlFor="feature-title">{t('featureTask.title')} <small>{t('featureTask.titleHint')}</small></label><input id="feature-title" value={featureTitle} onChange={event => setFeatureTitle(event.target.value)} placeholder={t('featureTask.titlePlaceholder')} maxLength={120} /><label htmlFor="feature-objective">{t('featureTask.objective')} <small>{t('featureTask.objectiveHint')}</small></label><textarea id="feature-objective" value={featureObjective} onChange={event => setFeatureObjective(event.target.value)} placeholder={t('featureTask.objectivePlaceholder')} maxLength={2000} /><label htmlFor="feature-criteria">{t('featureTask.acceptanceCriteria')} <small>{t('featureTask.criteriaHint')}</small></label><textarea id="feature-criteria" value={featureCriteria} onChange={event => setFeatureCriteria(event.target.value)} placeholder={t('featureTask.criteriaPlaceholder')} maxLength={4000} /><button className="primary-button" type="button" onClick={() => void createFeatureTask()} disabled={savingFeatureTask}>{savingFeatureTask ? t('featureTask.creating') : t('featureTask.createTask')}<ArrowRight size={15} aria-hidden="true" /></button></div> : <div className="feature-task-detail"><p>{featureTask.objective}</p><ol>{featureTask.acceptanceCriteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ol>{featureTask.pipeline && <div className="pipeline-section"><div className="pipeline-heading"><div><p className="eyebrow">Pipeline</p><h4>{featureTask.pipeline.steps.length} steps · {featureTask.pipeline.status}</h4></div>{featureTask.status === 'draft' && <button className="secondary-button" type="button" onClick={() => editingPipeline ? setEditingPipeline(false) : startEditPipeline()}>{editingPipeline ? 'Cancel' : 'Edit Pipeline'}</button>}</div>{editingPipeline ? <div className="pipeline-editor">{pipelineDraft.map((step, i) => <div key={step.id} className="pipeline-edit-step"><div className="pipeline-edit-header"><strong>Step {i + 1}</strong>{pipelineDraft.length > 1 && <button className="icon-button" type="button" onClick={() => removePipelineStep(step.id)} title="Remove step">×</button>}</div><label>Name<input value={step.name} onChange={e => updatePipelineStep(step.id, 'name', e.target.value)} placeholder="Step name" maxLength={120} /></label><label>Profile<select value={step.profileId} onChange={e => updatePipelineStep(step.id, 'profileId', e.target.value)}><option value="">Select profile...</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Prompt<textarea value={step.prompt} onChange={e => updatePipelineStep(step.id, 'prompt', e.target.value)} placeholder="Instructions for this step..." maxLength={4000} rows={3} /></label></div>)}<button className="secondary-button" type="button" onClick={addPipelineStep}>+ Add Step</button><button className="primary-button" type="button" onClick={() => void savePipeline()} disabled={savingPipeline}>{savingPipeline ? 'Saving...' : 'Save Pipeline'}</button></div> : <ol className="pipeline-steps">{featureTask.pipeline.steps.map((step, i) => { const result = featureTask.pipeline!.results.find(r => r.stepId === step.id); const status = result?.status ?? 'pending'; return <li key={step.id}><span className={`step-dot ${status}`} aria-hidden="true" /> <strong>{i + 1}. {step.name}</strong> <em>({step.profileId})</em> <span className="pipeline-step-status">{status}</span>{result?.error && <small className="pipeline-error">{result.error}</small>}</li>; })}</ol>}{!editingPipeline && featureTask.status === 'approved' && (featureTask.pipeline.status === 'idle' || featureTask.pipeline.status === 'failed' || featureTask.pipeline.status === 'paused') && <button className="primary-button" type="button" onClick={() => void executePipeline()} disabled={savingFeatureTask}>{savingFeatureTask ? 'Executing...' : featureTask.pipeline.status === 'paused' ? 'Resume Pipeline' : 'Execute Pipeline'}<ArrowRight size={15} aria-hidden="true" /></button>}</div>}{featureTask.status === 'draft' ? <>{approverField('feature-approver', t('featureTask.whoApproves'))}<button className="primary-button" type="button" onClick={() => void approveFeatureTask()} disabled={savingFeatureTask}>{savingFeatureTask ? t('featureTask.approving') : t('featureTask.approveForAgent')}<ShieldCheck size={15} aria-hidden="true" /></button></> : <small>{t('featureTask.approvedBy', { approvedBy: featureTask.approvedBy ?? '', date: featureTask.approvedAt ? formatDate(featureTask.approvedAt, locale) : '' })}</small>}</div>}</div>}
              {featureTask?.status === 'approved' && <div className="runtime-panel"><div className="runtime-heading"><div><p className="eyebrow">{t('runtime.eyebrow')}{selectedAgentId && agents.find(a => a.id === selectedAgentId) ? ` · ${agents.find(a => a.id === selectedAgentId)!.name}` : ''}</p><h3>{runtimeRun ? t('runtime.status', { mode: runtimeRun.plan.mode === 'execute' ? 'Codex' : 'Dry-run', status: runtimeRun.status }) : t('runtime.runtimeNotPrepared')}</h3><p>{runtimeRun?.status === 'completed' ? t('runtime.completed') : runtimeRun?.status === 'failed' ? t('runtime.failed', { attempts: runtimeRun.attempts }) : runtimeRun?.status === 'running' ? t('runtime.running') : runtimeRun ? t('runtime.planned') : t('runtime.prepareDescription')}</p></div>{runtimeRun?.status === 'planned' ? <div className="provider-actions"><button className="secondary-button" type="button" onClick={() => void cancelRuntime()} disabled={preparingRuntime}>{preparingRuntime ? t('runtime.cancelling') : t('runtime.cancelDryRun')}<RefreshCw size={15} aria-hidden="true" /></button><button className="primary-button" type="button" onClick={() => void executeRuntime()} disabled={preparingRuntime}>{preparingRuntime ? t('runtime.runningCodex') : t('runtime.runCodex')}<ArrowRight size={15} aria-hidden="true" /></button></div> : runtimeRun?.status === 'failed' ? <button className="primary-button" type="button" onClick={() => void retryRuntime()} disabled={preparingRuntime}>{preparingRuntime ? t('runtime.retryingCodex') : t('runtime.retryCodex')}<RefreshCw size={15} aria-hidden="true" /></button> : !runtimeRun && <button className="secondary-button" type="button" onClick={() => void prepareRuntime()} disabled={preparingRuntime}>{preparingRuntime ? t('runtime.preparing') : t('runtime.prepare')}<ArrowRight size={15} aria-hidden="true" /></button>}</div>{gitEvidence && <div className="git-evidence"><span>{t('runtime.gitBranch')} <strong>{gitEvidence.branch}</strong></span><span>{t('runtime.gitHead')} <strong>{gitEvidence.head.slice(0, 10)}</strong></span><span>{t('runtime.gitWorkingTree')} <strong>{gitEvidence.status || t('runtime.gitClean')}</strong></span><span>{t('runtime.gitDiff')} <strong>{gitEvidence.diffStat || t('runtime.gitNoChanges')}</strong></span></div>}{runtimeRun?.result?.output && <pre className="provider-report">{runtimeRun.result.output}</pre>}{runtimeRun?.history.length ? <div className="runtime-history"><small>{runtimeRun.history.length} {runtimeRun.history.length === 1 ? t('runtime.attemptRecorded') : t('runtime.attemptsRecorded')}</small></div> : null}</div>}
              {featureTask?.status === 'approved' && runtimeRun && <div className={`acceptance-panel ${acceptance?.status ?? 'pending'}`}><div className="runtime-heading"><div><p className="eyebrow">{t('acceptance.eyebrow')}</p><h3>{acceptance ? t('acceptance.acceptanceStatus', { status: acceptance.status }) : t('acceptance.submitTitle')}</h3><p>{acceptance?.status === 'blocked' ? t('acceptance.blocked', { status: acceptance.qualityStatus }) : t('acceptance.confirmCriteria')}</p></div>{acceptance?.status === 'ready' && <div className="acceptance-approval">{approverField('acceptance-approver', t('acceptance.whoAccepts'))}<button className="secondary-button" type="button" onClick={() => void approveDelivery()} disabled={submittingAcceptance}>{submittingAcceptance ? t('acceptance.approving') : t('acceptance.approveDelivery')}<ShieldCheck size={15} aria-hidden="true" /></button></div>}</div>{acceptance?.status !== 'approved' && <div className="acceptance-form"><label htmlFor="acceptance-summary">{t('acceptance.summary')} <small>{t('acceptance.summaryHint')}</small></label><textarea id="acceptance-summary" value={acceptanceSummary} onChange={event => setAcceptanceSummary(event.target.value)} placeholder={t('acceptance.summaryPlaceholder')} maxLength={2000} /><label className="check-row"><input type="checkbox" checked={criteriaConfirmed} onChange={event => setCriteriaConfirmed(event.target.checked)} /> {t('acceptance.reviewedCriteria')}</label><button className="primary-button" type="button" onClick={() => void submitAcceptance()} disabled={submittingAcceptance}>{submittingAcceptance ? t('acceptance.submitting') : t('acceptance.submitEvidence')}<ArrowRight size={15} aria-hidden="true" /></button></div>}</div>}
            </>}

            {view.kind === 'project' && view.tab === 'release' && selected && <>
              {finalDeliveryReport && <div className="final-report"><div className="artifact-heading"><div><p className="eyebrow">{t('simulation.eyebrow')}</p><h3>{t('evidence.finalDeliveryReport')}</h3></div><button className="icon-button" type="button" onClick={() => selected && void loadFinalDeliveryReport(selected.id)} aria-label={t('evidence.refreshReport')} title={t('evidence.refreshReport')}><RefreshCw size={17} /></button></div><pre className="provider-report">{finalDeliveryReport}</pre></div>}
              <p className="baseline-note">{t('simulation.note')}</p>
              <div className="provider-simulation"><div className="provider-simulation-heading"><div><p className="eyebrow">{t('simulation.eyebrow')}</p><h3>{t('simulation.title')}</h3><p>{t('simulation.description')}</p></div><span className="dry-run-tag">{t('simulation.noExternalWrites')}</span></div><div className="provider-plan-list">{providerPlans.map(plan => <article className="provider-plan" key={plan.providerId}><div><strong>{plan.providerId}</strong><small>{plan.idempotencyKey}</small></div><ol>{plan.resources.map(resource => <li key={resource.spec.id}><span>{resource.spec.id}</span><em>{resource.action}</em><small>{resource.reason}</small></li>)}</ol></article>)}</div><div className="provider-actions"><button className="secondary-button" type="button" onClick={() => void verifyProviders()} disabled={verifyingProviders}>{verifyingProviders ? t('simulation.verifying') : t('simulation.verifyState')}<RefreshCw size={15} aria-hidden="true" /></button>{baselineApproval && <button className="secondary-button" type="button" onClick={() => void applyFakeProviders()} disabled={applyingFakeProviders}>{applyingFakeProviders ? t('simulation.applying') : t('simulation.applyFakeProviders')}<ArrowRight size={15} aria-hidden="true" /></button>}</div>{providerVerification && <div className="provider-verification">{providerVerification.map(item => <span className={item.verified ? 'verified' : 'unverified'} key={item.providerId}>{item.verified ? t('simulation.verified', { providerId: item.providerId }) : t('simulation.unverified', { providerId: item.providerId, missing: item.missing.length, drift: item.mismatched.length })}</span>)}</div>}{providerReport && <pre className="provider-report">{providerReport}</pre>}</div>
            </>}
          </section>

          <aside className="right-rail">
            <form className="blueprint-panel" onSubmit={saveBlueprint}>
              <div className="panel-title"><div><p className="eyebrow">{selected ? `${t('blueprint.revision')} ${selected.blueprint.metadata.revision + 1}` : t('blueprint.createTitle')}</p><h2>{selected ? t('common.edit') : t('blueprint.createTitle')}</h2></div><Sparkles size={20} aria-hidden="true" /></div>
              <div className="mode-switch" role="group" aria-label={t('blueprint.mode')}>
                <button className={answers.mode === 'beginner' ? 'active' : ''} type="button" onClick={() => setAnswer('mode', 'beginner')}>{t('blueprint.beginner')}</button>
                <button className={answers.mode === 'professional' ? 'active' : ''} type="button" onClick={() => setAnswer('mode', 'professional')}>{t('blueprint.professional')}</button>
              </div>
              <label htmlFor="project-name">{t('blueprint.projectName')}</label>
              <input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder={t('blueprint.projectNamePlaceholder')} maxLength={80} disabled={Boolean(selected)} />
              <label htmlFor="product-intent">{t('blueprint.productIntent')}</label>
              <textarea id="product-intent" value={answers.productIntent} onChange={event => setAnswer('productIntent', event.target.value)} placeholder={t('blueprint.productIntentPlaceholder')} maxLength={500} />

              <fieldset className="choice-group"><legend>{t('blueprint.productType')}</legend><div className="choice-stack">
                {PRODUCT_TYPE_LABEL_KEYS.map(([type, labelKey]) => (
                  <label key={type}><input type="radio" name="productType" checked={answers.productType === type} onChange={() => setAnswer('productType', type)} />{t(labelKey)}</label>
                ))}
                <small>{t('blueprint.productTypeNote')}</small>
              </div></fieldset>

              {answers.productType === 'desktop' && <fieldset className="choice-group"><legend>{t('blueprint.desktopShell')}</legend><div className="choice-grid">
                <button className={answers.desktopShell === 'tauri' ? 'selected' : ''} type="button" onClick={() => setAnswer('desktopShell', 'tauri')}>{t('blueprint.desktopShellTauri')}</button>
                <button className={answers.desktopShell === 'electron' ? 'selected' : ''} type="button" onClick={() => setAnswer('desktopShell', 'electron')}>{t('blueprint.desktopShellElectron')}</button>
                <small>{t('blueprint.desktopShellNote')}</small>
              </div></fieldset>}

              <fieldset className="choice-group"><legend>{t('blueprint.dataSensitivity')}</legend><div className="choice-grid">
                <button className={answers.dataSensitivity === 'standard' ? 'selected' : ''} type="button" onClick={() => setAnswer('dataSensitivity', 'standard')}><CheckCircle2 size={15} />{t('blueprint.standard')}</button>
                <button className={answers.dataSensitivity === 'sensitive' ? 'selected' : ''} type="button" onClick={() => setAnswer('dataSensitivity', 'sensitive')}><ShieldCheck size={15} />{t('blueprint.sensitive')}</button>
              </div></fieldset>

              <fieldset className="choice-group"><legend>{t('blueprint.analytics')}</legend><p>{t('blueprint.analyticsNote')}</p><div className="choice-stack">
                <label><input type="checkbox" checked={answers.analyticsProviders.includes('ga4')} onChange={() => toggleAnalytics('ga4')} />{t('blueprint.googleAnalytics4')}</label>
                <label><input type="checkbox" checked={answers.analyticsProviders.includes('clarity')} onChange={() => toggleAnalytics('clarity')} />{t('blueprint.microsoftClarity')}</label>
              </div></fieldset>

              {isProfessional && <>
                <fieldset className="choice-group ownership-group"><legend>{t('blueprint.resourceOwnership')}</legend><p>{t('blueprint.ownershipNote')}</p>
                  {/* Only the providers this product type provisions are asked for: an MCP server or a
                      browser extension creates nothing on Vercel or Supabase, and asking anyway invited
                      the user to name owners for cloud projects the product would never use. */}
                  {ownershipFields.map(field => <Fragment key={field.id}>
                    <label htmlFor={field.id}>{t(field.labelKey)}</label>
                    <input id={field.id} value={answers[field.answerKey]} onChange={event => setAnswer(field.answerKey, event.target.value)} placeholder={t('common.egAcme')} maxLength={120} />
                  </Fragment>)}
                </fieldset>
                <fieldset className="choice-group"><legend>{t('blueprint.previewWorkflow')}</legend><div className="choice-stack">
                  <label><input type="radio" name="preview" checked={answers.previewStrategy === 'per-pull-request'} onChange={() => setAnswer('previewStrategy', 'per-pull-request')} />{t('blueprint.perPullRequest')}</label>
                  <label><input type="radio" name="preview" checked={answers.previewStrategy === 'stable-dev-api'} onChange={() => setAnswer('previewStrategy', 'stable-dev-api')} />{t('blueprint.stableDevApi')}</label>
                </div></fieldset>
                <fieldset className="choice-group"><legend>{t('blueprint.runtime')}</legend><p>{t('blueprint.runtimeNote')}</p><div className="choice-stack">
                  {agents.length === 0 && profiles.length === 0 ? <small>{t('blueprint.runtimeCatalogLoading')}</small> : <>
                    {agents
                      .flatMap(agent => {
                        const provider = runtimeProviderSchema.safeParse(`local-${agent.id}`);
                        return agent.detected && provider.success ? [{ agent, provider: provider.data }] : [];
                      })
                      .map(({ agent, provider }) => {
                        const copy = agentCopyKeys(agent.id);
                        const adapterVerified = agent.adapterStatus === 'verified';
                        return (
                          <label key={agent.id} className="agent-option">
                            <div className="agent-option-header">
                              <input type="radio" name="runtime" checked={answers.runtimeProvider === provider} onChange={() => setAnswer('runtimeProvider', provider)} />
                              <span className="agent-name">{agent.name}{agent.version ? ` (${agent.version})` : ''}{agent.source === 'custom' ? ` · ${t('agents.custom')}` : ''}</span>
                              {/* Being detected only means the CLI is installed. A candidate Adapter is
                                  refused at execution time by the daemon, so stamping every installed
                                  Agent "Verified" promised a guarantee this product does not have. */}
                              <span className={`agent-badge ${adapterVerified ? 'verified' : 'candidate'}`}>{adapterVerified ? t('blueprint.runtimeVerified') : t('blueprint.runtimeCandidate')}</span>
                            </div>
                            {copy && <p className="agent-desc">{t(copy.desc)}</p>}
                          </label>
                        );
                      })}
                    {profiles.map(profile => {
                      const baseAgent = agents.find(a => a.id === profile.baseAgentId);
                      const ready = baseAgent?.detected ?? false;
                      return (
                        <label key={profile.id} className="agent-option" style={{ opacity: ready ? 1 : 0.5 }}>
                          <div className="agent-option-header">
                            <input type="radio" name="runtime" checked={answers.runtimeProvider === profile.id} onChange={() => setAnswer('runtimeProvider', profile.id)} disabled={!ready} />
                            <span className="agent-name">{profile.icon ? `${profile.icon} ` : ''}{profile.name} · Profile</span>
                            <span className="agent-badge profile">Profile</span>
                          </div>
                          <p className="agent-desc">Based on {baseAgent?.name ?? profile.baseAgentId}{!ready && ` — ${t('blueprint.runtimeNotDetected')}`}</p>
                        </label>
                      );
                    })}
                    {/* Show not-detected agents with install guide */}
                    {agents.filter(a => !a.detected).map(agent => {
                      const copy = agentCopyKeys(agent.id);
                      return (
                        <div key={agent.id} className="agent-option not-detected">
                          <div className="agent-option-header">
                            <span className="agent-name" style={{ opacity: 0.6 }}>{agent.name}</span>
                            <span className="agent-badge not-detected">{t('blueprint.runtimeNotDetected')}</span>
                          </div>
                          {copy && <p className="agent-desc">{t(copy.desc)}</p>}
                          {copy?.install && <p className="agent-install"><code>{t(copy.install)}</code></p>}
                        </div>
                      );
                    })}
                  </>}
                  {agents.filter(agent => agent.detected).length === 0 && profiles.length === 0 && <small>{t('blueprint.runtimeNoneDetected')}</small>}
                </div></fieldset>
                <label htmlFor="custom-instructions">{t('blueprint.customImplementationNote')}</label>
                <textarea id="custom-instructions" value={answers.customInstructions} onChange={event => setAnswer('customInstructions', event.target.value)} placeholder={t('blueprint.customInstructionsPlaceholder')} maxLength={1000} />
              </>}

              <p className="form-note">{t('blueprint.baselineNote')}</p>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? t('common.loading') : selected ? t('blueprint.saveRevision') : t('blueprint.generate')}<ArrowRight size={16} aria-hidden="true" /></button>
            </form>
            <section className="connector-panel" id="connections">
              <div className="panel-title"><div><p className="eyebrow">{t('common.localOnly')}</p><h2>{t('connections.title')}</h2></div><PlugZap size={19} aria-hidden="true" /></div>
              <p className="form-note">{t('connections.checksOnly')}</p>
              <button className="secondary-button" type="button" onClick={() => void runPreflight()} disabled={checkingPreflight}>{checkingPreflight ? t('connections.checking') : t('connections.runPreflight')}<RefreshCw size={15} aria-hidden="true" /></button>
              <button className="secondary-button discovery-button" type="button" onClick={() => void discoverAccounts()} disabled={discoveringAccounts}>{discoveringAccounts ? t('connections.discovering') : t('connections.discoverIdentities')}<PlugZap size={15} aria-hidden="true" /></button>
              {preflight && <>
                <p className="preflight-summary">{preflight.readyForAccountDiscovery ? t('connections.allReady') : t('connections.attentionNeeded')}</p>
                <div className="connector-list">{preflight.connectors.map(connector => <article className="connector" key={connector.id}>
                  <div><h3>{connector.title}</h3><p>{connector.version ?? connector.command}</p><small>{connector.detail}</small><em>{connector.nextAction}</em></div><span className={`connector-status ${connector.status}`}>{connector.status === 'available' ? t('connections.available') : connector.status === 'missing' ? t('connections.installRequired') : t('connections.needsAttention')}</span>
                </article>)}</div>
              </>}
              {accountDiscovery && <div className="discovery-list">{accountDiscovery.accounts.map(account => <article className="connector" key={account.id}>
                <div><h3>{account.title}</h3><p>{account.identity ?? t('connections.noIdentity')}</p><small>{account.detail}</small><em>{account.nextAction}</em></div><span className={`connector-status ${account.status}`}>{account.status === 'authenticated' ? t('connections.authenticated') : account.status === 'manual' ? t('connections.manual') : account.status === 'missing' ? t('connections.installRequired') : t('connections.signInRequired')}</span>
              </article>)}</div>}
            </section>
          </aside>
        </div>
        )}

        {view.kind === 'credentials' && (
          <div className="standalone-view">
            {credentialsPanel}
          </div>
        )}

        {view.kind === 'agents' && (
          <div className="standalone-view">
            {agentsPanel}
          </div>
        )}

        {view.kind === 'activity' && (
          <div className="standalone-view">
            {activityPanel}
          </div>
        )}
      </section>
    </main>
  );
}
