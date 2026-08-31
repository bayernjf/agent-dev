// Side-effect module: attaches the daemon bearer token to every /api/* request.
// The daemon rejects unauthenticated /api/* calls (docs/audit-2026-08-31.md §6.1-2); the token is
// injected at build/dev-server start by vite.config.ts from ~/.agent-dev/daemon-token. Wrapping
// window.fetch once here covers every existing call site and any future one without touching them.
const token = typeof __DAEMON_TOKEN__ === 'string' ? __DAEMON_TOKEN__ : '';

if (token) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/api/')) return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  };
}
