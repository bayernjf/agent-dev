import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Boxes, CircleDot, FolderKanban, Plus, RefreshCw, Settings2 } from 'lucide-react';

type Project = {
  id: string;
  name: string;
  productType: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityEntry = {
  id: string;
  text: string;
  time: string;
};

const defaultActivity: ActivityEntry[] = [
  { id: 'local-ready', text: 'Local delivery control plane ready', time: 'Now' },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>(defaultActivity);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('The local daemon is unavailable.');
      const payload = (await response.json()) as { projects: Project[] };
      setProjects(payload.projects);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
    const source = new EventSource('/events');
    source.addEventListener('project.created', event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { projectName: string; occurredAt: string };
      setActivity(current => [
        { id: crypto.randomUUID(), text: `Project created: ${payload.projectName}`, time: formatDate(payload.occurredAt) },
        ...current,
      ].slice(0, 5));
      void loadProjects();
    });
    return () => source.close();
  }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Use a project name with at least two characters.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create project.');
      setName('');
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create project.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><Boxes size={20} aria-hidden="true" /><span>Agent-Dev</span></div>
        <nav aria-label="Studio navigation">
          <a className="nav-item active" href="#projects"><FolderKanban size={18} aria-hidden="true" />Projects</a>
          <a className="nav-item" href="#activity"><Activity size={18} aria-hidden="true" />Activity</a>
          <a className="nav-item" href="#standards"><Settings2 size={18} aria-hidden="true" />Standards</a>
        </nav>
        <div className="sidebar-note"><CircleDot size={14} aria-hidden="true" />Local daemon connected</div>
      </aside>

      <section className="workspace" id="projects">
        <header className="topbar">
          <div><p className="eyebrow">Delivery Control Plane</p><h1>Projects</h1></div>
          <button className="icon-button" type="button" onClick={() => void loadProjects()} aria-label="Refresh projects" title="Refresh projects"><RefreshCw size={18} /></button>
        </header>

        <div className="content-grid">
          <section className="project-area" aria-label="Projects">
            <div className="section-heading"><div><h2>Active delivery runs</h2><p>Each project begins with the v0.1 Web SaaS baseline.</p></div><span className="count">{projects.length}</span></div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="project-table" role="table" aria-label="Projects">
              <div className="table-head" role="row"><span>Project</span><span>Blueprint</span><span>Delivery state</span><span>Updated</span></div>
              {loading ? <p className="empty-state">Loading projects...</p> : projects.length === 0 ? <p className="empty-state">No projects yet. Create one to establish its delivery baseline.</p> : projects.map(project => (
                <div className="table-row" role="row" key={project.id}>
                  <strong>{project.name}</strong><span>{project.productType}</span><span className="state">{project.state.replaceAll('_', ' ')}</span><time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
                </div>
              ))}
            </div>
          </section>

          <aside className="right-rail">
            <form className="create-panel" onSubmit={createProject}>
              <div className="panel-title"><div><p className="eyebrow">New baseline</p><h2>Create project</h2></div><Plus size={20} aria-hidden="true" /></div>
              <label htmlFor="project-name">Project name</label>
              <input id="project-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Receipt Desk" maxLength={80} />
              <p className="form-note">React/Vite, Hono, Supabase, Cloudflare Pages and Vercel Functions are applied as the default baseline.</p>
              <button className="primary-button" type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create project'}</button>
            </form>
            <section className="activity-panel" id="activity"><div className="panel-title"><h2>Activity</h2><Activity size={18} aria-hidden="true" /></div><ol>{activity.map(item => <li key={item.id}><span>{item.text}</span><time>{item.time}</time></li>)}</ol></section>
          </aside>
        </div>
      </section>
    </main>
  );
}
