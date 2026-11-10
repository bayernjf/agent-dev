# ---- deps: install every workspace dependency once, cached independently of source ----
# node:22-slim pinned by digest (Node 22.23.4 / bookworm-slim), matching .node-version (22)
# and package.json engines (>=22.0.0). Refresh the digest deliberately, never by letting the
# tag float.
FROM node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS deps
WORKDIR /app
# registry.npmjs.org drops TLS connections at random from this network; the
# mirror serves the same packages.
ENV npm_config_registry=https://registry.npmmirror.com

# Manifests first so a source-only change reuses this layer.
COPY package.json package-lock.json .npmrc ./
COPY apps/cli/package.json apps/cli/
COPY apps/daemon/package.json apps/daemon/
COPY apps/studio/package.json apps/studio/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/blueprint/package.json packages/blueprint/
COPY packages/deployment-composer/package.json packages/deployment-composer/
COPY packages/policy/package.json packages/policy/
COPY packages/provider-cli/package.json packages/provider-cli/
COPY packages/provider-core/package.json packages/provider-core/
COPY packages/storage/package.json packages/storage/
COPY packages/workflow/package.json packages/workflow/
RUN npm ci && npm cache clean --force

# ---- runtime: the daemon only, running as the unprivileged `node` user ----
FROM node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app

# Workspace packages export TypeScript sources and the daemon start script runs them through
# tsx, so devDependencies cannot be pruned here: tsx is a real runtime requirement of this
# repository (unlike a compiled build). Keep the full install; do not "optimise" it away.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json .npmrc .node-version tsconfig.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node tools ./tools

# State (SQLite database, custom agent registry) lives on a volume so it survives restarts.
# The daemon token and provider credentials default to $HOME/.agent-dev, which the node user owns.
ENV NODE_ENV=production \
    AGENT_DEV_PORT=3737 \
    AGENT_DEV_DATABASE_PATH=/data/agent-dev.sqlite
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

# Loopback-only is a security constraint, not a packaging choice: the API is authenticated only
# by a per-user bearer token and is pinned to 127.0.0.1 (docs/audit-2026-08-31.md S1/§6.1-2).
# Publish it by running the container with --network host and proxying from the same host, or
# by changing the bind deliberately together with an auth redesign. EXPOSE documents the port;
# it does not make the loopback listener externally reachable.
EXPOSE 3737

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const port=process.env.AGENT_DEV_PORT||3737;fetch('http://127.0.0.1:'+port+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "apps/daemon/src/server.ts"]
