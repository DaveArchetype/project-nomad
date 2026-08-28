#!/bin/sh

set -e

echo "Starting entrypoint script..."

# Ensure required storage directories exist (volume may be freshly mounted)
mkdir -p /app/storage/logs /app/storage/kb_uploads

# Provision SearXNG settings.yml so the JSON API is enabled when the user installs
# SearXNG via Supply Depot. The ServiceSeeder mounts <storage>/searxng:/etc/searxng,
# so SearXNG reads this file on startup. We write the bundled template (injecting the
# secret from SEARXNG_SECRET_KEY) if no settings.yml exists OR if the existing one
# lacks the "formats:" key (i.e. it's the SearXNG default that blocks the JSON API).
# User-customized settings that already include formats are left untouched.
mkdir -p /app/storage/searxng
NEEDS_WRITE=0
if [ ! -f /app/storage/searxng/settings.yml ]; then
  NEEDS_WRITE=1
elif ! grep -q "^  formats:" /app/storage/searxng/settings.yml 2>/dev/null; then
  NEEDS_WRITE=1
fi
if [ "$NEEDS_WRITE" = "1" ]; then
  SEARXNG_SECRET="${SEARXNG_SECRET_KEY:-nomad-searxng-default-secret-replace-me}"
  sed "s/__SEARXNG_SECRET_KEY__/${SEARXNG_SECRET}/" /app/install/searxng/settings.yml > /app/storage/searxng/settings.yml
fi

# Wait for Redis to be reachable before booting anything that opens a BullMQ
# connection. `depends_on: condition: service_healthy` only gates a clean
# `up --recreate`; it is NOT re-checked on `docker compose restart` or a
# `restart: unless-stopped` bounce, so without this the app can race Docker's
# DNS (EAI_AGAIN) or dial a restarted Redis container's stale IP (ECONNREFUSED).
# This isn't load-bearing since legacy installs used a mounted entrypoint script
# that may override this script, but it's a cost-nothing check for newer installs.
# The real check is done by the application itself, but this provides a safety net.
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
echo "Waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}..."
for i in $(seq 1 60); do
  if node -e "const net=require('net');const s=net.connect(Number(process.env.REDIS_PORT||6379),process.env.REDIS_HOST||'redis');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));" 2>/dev/null; then
    echo "Redis is up and running!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Timed out waiting for Redis at ${REDIS_HOST}:${REDIS_PORT}" >&2
    exit 1
  fi
  sleep 1
done

# Run AdonisJS migrations
echo "Running AdonisJS migrations..."
node ace migration:run --force

# Seed the database if needed
echo "Seeding the database..."
node ace db:seed

# Start background workers for all queues (unless running in a dedicated
# worker container — see the `worker` service in management_compose.yaml).
if [ "${START_WORKER:-true}" = "true" ]; then
  echo "Starting background workers for all queues..."
  node ace queue:work --all &
fi

# Start the AdonisJS application
echo "Starting AdonisJS application..."
exec node bin/server.js