# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Multi-stage build.
#
# The runtime image carries only compiled JavaScript and production
# dependencies: no TypeScript compiler, no test framework, no source. That keeps
# the image small and removes build tooling from the attack surface.
#
# Node 24 is pinned deliberately: the HTTP QUERY verb this API exposes needs a
# runtime whose HTTP parser recognises it (Node 22+).
# ---------------------------------------------------------------------------
ARG NODE_VERSION=24-alpine

# --- Stage 1: full dependency tree, used to compile -------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs exactly the lockfile, so an image built today and one built
# next month contain the same dependency tree.
RUN npm ci

# --- Stage 2: compile TypeScript -------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- Stage 3: production dependencies only ----------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Stage 4: runtime -------------------------------------------------------
FROM node:${NODE_VERSION} AS runner

# dumb-init becomes PID 1 so SIGTERM reaches Node directly. Without it Node runs
# as PID 1, ignores default signal handling, and `docker compose down` has to
# wait for the kill timeout on every stop.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist        ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker/entrypoint.sh docker/healthcheck.js ./docker/

RUN chmod +x ./docker/entrypoint.sh

# Never run as root. The image ships with an unprivileged `node` user already.
USER node

EXPOSE 3000

# Implemented in Node rather than curl, so no extra package is installed just to
# probe the service. It hits the same /health endpoint clients use, which also
# verifies PostgreSQL connectivity.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "docker/healthcheck.js"]

ENTRYPOINT ["dumb-init", "--", "./docker/entrypoint.sh"]
CMD ["node", "dist/main.js"]
