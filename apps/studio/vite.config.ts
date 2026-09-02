import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDaemonAuthHandler, type ProxyRequestLike } from './dev-proxy-auth';

// The daemon binds to 127.0.0.1 explicitly, so proxy to that literal address instead of
// `localhost`, which can resolve to ::1 first on Windows and miss the listener.
const daemonOrigin = 'http://127.0.0.1:3737';

type ProxyServerLike = {
  on(event: string, listener: (proxyRequest: ProxyRequestLike) => void): void;
};

// The daemon bearer token is attached here, in the proxy, and never reaches the browser (see
// dev-proxy-auth.ts for why not). `/events` is an SSE stream outside the authenticated /api/*
// surface: EventSource cannot carry headers, and it publishes delivery metadata only.
const proxy = {
  '/api': {
    target: daemonOrigin,
    configure: (proxyServer: ProxyServerLike) => {
      proxyServer.on('proxyReq', createDaemonAuthHandler());
    },
  },
  '/events': daemonOrigin,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  // `vite preview` needs the same plumbing, otherwise a built Studio has no way to reach the API.
  preview: {
    proxy,
  },
});
