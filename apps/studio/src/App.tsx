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
  const [selectedArtifactId, setSelectedArtifactId] = useState<DryRunPlan['artifacts'][number]['id'] | null>(null);
  const [preflight, setPreflight] = useState<ConnectorPreflightReport | null>(null);
  const [accountDiscovery, setAccountDiscovery] = useState<AccountDiscoveryReport | null>(null);
  const [checkingPreflight, setCheckingPreflight] = useState(false);
  const [discoveringAccounts, setDiscoveringAccounts] = useState(false);
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
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this Blueprint.');
    }
  };

  const loadBaselinePlan = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/baseline-plan`);
      if (!response.ok) throw new Error('Unable to prepare the baseline plan.');
      const payload = await response.json() as { plan: BaselinePlan };
      setBaselinePlan(payload.plan);
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

  const startNewProject = () => {
    setSelected(null);
    setDryRun(null);
    setBaselinePlan(null);
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

  useEffect(() => {
    void loadProjects();
    const source = new EventSource('/events');
    const onEvent = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { type: string; projectId: string; projectName: string; occurredAt: string };
      setActivity(current => [
        { id: crypto.randomUUID(), text: `${payload.type === 'blueprint.revised' ? 'Blueprint revised' : 'Project created'}: ${payload.projectName}`, time: formatDate(payload.occurredAt) },
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
              <div className="section-heading"><div><p className="eyebrow">Resource plan · Revision {baselinePlan.blueprintRevision}</p><h2>Baseline resources</h2><p>{baselinePlan.summary}</p></div><span className={`baseline-tag ${baselinePlan.readyForApproval ? 'ready' : 'blocked'}`}>{baselinePlan.readyForApproval ? 'Ready for approval' : 'Ownership required'}</span></div>
              <div className="baseline-list">{baselinePlan.resources.map(resource => <article className="baseline-resource" key={resource.id}>
                <div><h3>{resource.title}</h3><p>{resource.owner ?? 'Not selected'}</p><small>{resource.reason}</small></div><span className={`resource-status ${resource.status}`}>{resource.status === 'blocked' ? 'Blocked' : 'Awaiting approval'}</span>
              </article>)}</div>
              <p className="baseline-note">This is a plan only. No remote resource has been created. The future Apply action will require a separate explicit approval.</p>
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
