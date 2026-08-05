import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, ArrowRight, Boxes, CheckCircle2, CircleDot, FolderKanban, PlugZap, RefreshCw, Settings2, ShieldCheck, Sparkles,
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
type ApplyRun = { id: string; projectId: string; blueprintRevision: number; status: 'queued' | 'running' | 'completed' | 'failed'; attempts: number; workspacePath: string; steps: ApplyStep[]; createdAt: string; updatedAt: string };
type DependencyReadiness = { status: 'not-applied' | 'missing-dependencies' | 'ready'; workspacePath: string | null; packageLockPresent: boolean; nodeModulesPresent: boolean; qualityCommandPresent: boolean; nextAction: string };
type QualityGateResult = { status: 'passed' | 'failed'; command: string; exitCode: number; output: string; completedAt: string };
type DependencyInstallResult = { status: 'installed' | 'failed'; exitCode: number; output: string; completedAt: string };
type ProviderPlan = { providerId: string; idempotencyKey: string; noExternalChanges: true; resources: { spec: { id: string; kind: string; owner: string }; action: 'create' | 'update' | 'noop'; reason: string }[] };
type ProviderVerification = { providerId: string; verified: boolean; missing: string[]; mismatched: string[] };

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
  const [providerPlans, setProviderPlans] = useState<ProviderPlan[]>([]);
  const [providerVerification, setProviderVerification] = useState<ProviderVerification[] | null>(null);
  const [providerReport, setProviderReport] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<DryRunPlan['artifacts'][number]['id'] | null>(null);
  const [preflight, setPreflight] = useState<ConnectorPreflightReport | null>(null);
  const [accountDiscovery, setAccountDiscovery] = useState<AccountDiscoveryReport | null>(null);
  const [checkingPreflight, setCheckingPreflight] = useState(false);
  const [discoveringAccounts, setDiscoveringAccounts] = useState(false);
  const [approvingBaseline, setApprovingBaseline] = useState(false);
  const [applyingBaseline, setApplyingBaseline] = useState(false);
  const [installingDependencies, setInstallingDependencies] = useState(false);
  const [applyingFakeProviders, setApplyingFakeProviders] = useState(false);
  const [verifyingProviders, setVerifyingProviders] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([{ id: 'local-ready', text: 'Local delivery control plane ready', time: 'Now' }]);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<BlueprintAnswers>(defaultAnswers);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      void loadProviderPlan(projectId);
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

  const startNewProject = () => {
    setSelected(null);
    setDryRun(null);
    setBaselinePlan(null);
    setBaselineApproval(null);
    setApplyRun(null);
    setDependencyReadiness(null);
    setQualityGateResult(null);
    setProviderPlans([]);
    setProviderVerification(null);
    setProviderReport('');
    setSelectedArtifactId(null);
    setName('');
    setAnswers(defaultAnswers);
    setError('');
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
    const confirmed = window.confirm('Record approval for this baseline? No remote resource will be created.');
    if (!confirmed) return;
    setApprovingBaseline(true);
    try {
      const response = await fetch(`/api/projects/${selected.id}/baseline-plan/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintRevision: baselinePlan.blueprintRevision, confirmation: 'APPROVE_BASELINE' }),
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
        <div className="brand"><Boxes size={20} aria-hidden="true" /><span>Agent-Dev</span></div>
        <nav aria-label="Studio navigation">
          <a className="nav-item active" href="#projects"><FolderKanban size={18} aria-hidden="true" />Projects</a>
          <a className="nav-item" href="#decisions"><ShieldCheck size={18} aria-hidden="true" />Decisions</a>
          <a className="nav-item" href="#connections"><PlugZap size={18} aria-hidden="true" />Connections</a>
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

            {selected && baselinePlan && <section className="baseline-section">
              <div className="section-heading"><div><p className="eyebrow">Resource plan · Revision {baselinePlan.blueprintRevision}</p><h2>Baseline resources</h2><p>{baselinePlan.summary}</p></div><span className={`baseline-tag ${baselineApproval ? 'approved' : baselinePlan.readyForApproval ? 'ready' : 'blocked'}`}>{baselineApproval ? 'Approved' : baselinePlan.readyForApproval ? 'Ready for approval' : 'Ownership required'}</span></div>
              <div className="baseline-list">{baselinePlan.resources.map(resource => <article className="baseline-resource" key={resource.id}>
                <div><h3>{resource.title}</h3><p>{resource.owner ?? 'Not selected'}</p><small>{resource.reason}</small></div><span className={`resource-status ${resource.status}`}>{resource.status === 'blocked' ? 'Blocked' : baselineApproval ? 'Approved' : 'Awaiting approval'}</span>
              </article>)}</div>
              {baselineApproval ? <div className="approval-record"><CheckCircle2 size={17} aria-hidden="true" /><div><strong>Baseline approval recorded</strong><small>Revision {baselineApproval.blueprintRevision} · {baselineApproval.approvedBy} · {formatDate(baselineApproval.approvedAt)}</small></div></div> : baselinePlan.readyForApproval ? <div className="approval-action"><p>This records intent only. It does not create remote resources or reveal secrets.</p><button className="primary-button" type="button" onClick={() => void approveBaseline()} disabled={approvingBaseline}>{approvingBaseline ? 'Recording approval...' : 'Approve baseline plan'}<ShieldCheck size={16} aria-hidden="true" /></button></div> : null}
              {baselineApproval && !applyRun && <div className="approval-action"><p>Run the local simulator to create the delivery package in the ignored `.agent-dev` workspace.</p><button className="primary-button" type="button" onClick={() => void applyBaseline()} disabled={applyingBaseline}>{applyingBaseline ? 'Applying locally...' : 'Run local Apply'}<ArrowRight size={16} aria-hidden="true" /></button></div>}
              {applyRun && <div className={`apply-run ${applyRun.status}`}><div className="apply-run-heading"><strong>Local Apply {applyRun.status}</strong><small>Attempt {applyRun.attempts} of 3 · {applyRun.workspacePath}</small></div><ol>{applyRun.steps.map(step => <li key={step.id}><span className={`step-dot ${step.status}`} aria-hidden="true" /> <span>{step.title}</span><em>{step.status}</em>{step.detail && <small>{step.detail}</small>}</li>)}</ol>{applyRun.status === 'failed' && applyRun.attempts < 3 && <button className="secondary-button retry-button" type="button" onClick={() => void retryApply()} disabled={applyingBaseline}>{applyingBaseline ? 'Retrying...' : 'Retry local Apply'}<RefreshCw size={15} aria-hidden="true" /></button>}</div>}
              {applyRun?.status === 'completed' && dependencyReadiness && <div className={`quality-gate ${dependencyReadiness.status}`}><div><p className="eyebrow">Local quality gate</p><h3>{qualityGateResult ? `Last run: ${qualityGateResult.status}` : dependencyReadiness.status === 'ready' ? 'Ready to run' : 'Dependencies required'}</h3><p>{dependencyReadiness.nextAction}</p></div>{dependencyReadiness.status === 'missing-dependencies' && <button className="secondary-button" type="button" onClick={() => void installDependencies()} disabled={installingDependencies}>{installingDependencies ? 'Installing...' : 'Install dependencies'}<ArrowRight size={15} aria-hidden="true" /></button>}{dependencyReadiness.status === 'ready' && <button className="secondary-button" type="button" onClick={() => void runQualityGate()} disabled={applyingBaseline}>{applyingBaseline ? 'Running...' : 'Run quality gate'}<CheckCircle2 size={15} aria-hidden="true" /></button>}</div>}
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
            <section className="activity-panel" id="activity"><div className="panel-title"><h2>Activity</h2><Activity size={18} aria-hidden="true" /></div><ol>{activity.map(item => <li key={item.id}><span>{item.text}</span><time>{item.time}</time></li>)}</ol></section>
          </aside>
        </div>
      </section>
    </main>
  );
}
