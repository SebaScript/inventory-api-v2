#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint.
#
# Its single job is to make sure PostgreSQL is reachable before the application
# starts. Migrations and demo data are applied by the application itself, driven
# by RUN_MIGRATIONS_ON_START and SEED_ON_START — one owner for that logic, and
# it behaves identically whether the API runs in Docker or not.
#
# Together they are what makes `docker compose up --build` produce a working,
# populated API on a clean machine with no manual step: no psql, no migration
# command, no seed script.
# ---------------------------------------------------------------------------
set -e

log() { echo "[entrypoint] $*"; }

# Compose's `depends_on: service_healthy` already gates startup, but a restarted
# database or a slow first boot can still leave a window where the server is up
# and not yet accepting connections. Retrying here makes the container resilient
# on its own rather than relying solely on orchestration.
if [ -n "$DATABASE_URL" ]; then
  attempt=1
  max_attempts=${DB_WAIT_ATTEMPTS:-30}

  until node -e "
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect()
      .then(() => client.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  " 2>/dev/null; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      log "PostgreSQL unreachable after ${max_attempts} attempts, giving up."
      exit 1
    fi
    log "Waiting for PostgreSQL (${attempt}/${max_attempts})..."
    attempt=$((attempt + 1))
    sleep 2
  done

  log "PostgreSQL is accepting connections."
fi

log "Starting API (NODE_ENV=${NODE_ENV:-development}, PORT=${PORT:-3000})"

# `exec` replaces the shell with Node, so the application becomes the process
# dumb-init supervises and receives SIGTERM directly on shutdown.
exec "$@"
