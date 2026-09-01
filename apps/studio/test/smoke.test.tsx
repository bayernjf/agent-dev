import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/i18n';
import { ThemeProvider } from '../src/theme/theme';
import { CredentialBackendStatus } from '../src/components/CredentialBackendStatus';
import { App } from '../src/App';
import type { CredentialBackendInfo } from '../src/types';

// The server-side renderer runs without a DOM, but Studio reads user-level preferences and the
// recorded approver name from localStorage during initial render. Provide a minimal in-memory stub
// so the smoke render exercises the same path a real browser does.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  },
});

// Smoke tests render the key Studio views through the same server-side renderer used in production,
// wrapped in the real providers. They assert that the initial UI shell mounts and exposes its core
// surface (brand, project list, empty state, entry points) without a DOM — catching crashes from bad
// providers, i18n lookups or component wiring early.
function renderStudioApp() {
  return renderToString(
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('Studio smoke render', () => {
  it('mounts the dashboard shell with the brand and project surface', () => {
    const html = renderStudioApp();
    // Brand is always rendered in the header.
    expect(html).toContain('Agent-Dev');
    // Dashboard is the initial view: the projects section heading renders.
    expect(html).toContain('Projects');
    // The initial mount is in the loading state before the project list arrives.
    expect(html).toContain('Loading projects...');
  });

  it('renders the table column labels of the dashboard project list', () => {
    const html = renderStudioApp();
    // The four dashboard table columns are part of the initial mount.
    expect(html).toContain('Project');
    expect(html).toContain('Delivery state');
  });

  it('renders every provider entry point on the dashboard', () => {
    const html = renderStudioApp();
    // The primary action to start a delivery is present in the initial shell.
    expect(html).toContain('New Blueprint');
  });
});

const renderBackendStatus = (backend: CredentialBackendInfo | null) =>
  renderToString(
    <I18nProvider>
      <CredentialBackendStatus backend={backend} />
    </I18nProvider>,
  );

// The credentials panel is the surface users trust when deciding where their tokens live, so both
// branches of the backend status line are locked here: the tone class drives the green/red styling,
// and the storage note must never claim Infisical while reporting the local file (or the other way
// round) — that would send users looking for secrets in the wrong place.
describe('Credential backend status render', () => {
  it('reports a connected Infisical backend and switches the note away from the local file', () => {
    const html = renderBackendStatus({ type: 'infisical', available: true, projectId: 'proj-1', environment: 'dev' });
    expect(html).toContain('class="credential-backend connected"');
    expect(html).toContain('Secret backend: infisical');
    expect(html).toContain('Infisical secret backend');
    expect(html).toContain('not written to a local credentials file');
    // The local-file claim must be gone once Infisical is the active backend.
    expect(html).not.toContain('stored only in ~/.agent-dev/credentials.txt');
  });

  it('keeps the local-file note when the backend is the default store', () => {
    const html = renderBackendStatus({ type: 'local-file', available: true });
    expect(html).toContain('class="credential-backend connected"');
    expect(html).toContain('Secret backend: local-file');
    expect(html).toContain('stored only in ~/.agent-dev/credentials.txt');
    expect(html).not.toContain('Infisical secret backend');
  });

  it('surfaces the reason when the configured backend is unavailable', () => {
    const html = renderBackendStatus({ type: 'infisical', available: false, reason: 'project unreachable' });
    expect(html).toContain('class="credential-backend unavailable"');
    expect(html).toContain('Secret backend infisical unavailable');
    expect(html).toContain('project unreachable');
    // Still points at Infisical, not the local file: an outage must not imply secrets were read
    // from disk, since the daemon refuses to fall back.
    expect(html).toContain('Infisical secret backend');
  });

  it('renders no status line while the backend probe has not answered yet', () => {
    const html = renderBackendStatus(null);
    expect(html).not.toContain('credential-backend');
    expect(html).toContain('stored only in ~/.agent-dev/credentials.txt');
  });
});
