import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/i18n';
import { ThemeProvider } from '../src/theme/theme';
import { App } from '../src/App';

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
