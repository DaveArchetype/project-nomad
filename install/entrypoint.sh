#!/bin/sh

set -e

echo "Starting entrypoint script..."

# Ensure required storage directories exist (volume may be freshly mounted)
mkdir -p /app/storage/logs /app/storage/kb_uploads

# Provision SearXNG settings.yml so the JSON API is enabled when the user installs
# SearXNG via Supply Depot. The ServiceSeeder mounts <storage>/searxng:/etc/searxng,
# so SearXNG reads this file on startup. We only write if missing (never overwrite
# user customizations). The secret_key is sourced from SEARXNG_SECRET_KEY (.env).
mkdir -p /app/storage/searxng
if [ ! -f /app/storage/searxng/settings.yml ]; then
  SEARXNG_SECRET="${SEARXNG_SECRET_KEY:-nomad-searxng-default-secret-replace-me}"
  cat > /app/storage/searxng/settings.yml <<SEARXNG_SETTINGS
use_default_settings: true

general:
  instance_name: "Project NOMAD Search"
  debug: false

search:
  safe_search: 0
  autocomplete: ""
  default_lang: "en"
  formats:
    - html
    - json

server:
  secret_key: "${SEARXNG_SECRET}"
  limiter: false
  image_proxy: true
  bind_address: "0.0.0.0"
  port: 8080

ui:
  static_use_hash: true

outgoing:
  request_timeout: 10
  max_request_timeout: 15
  useragent_suffix: ""
SEARXNG_SETTINGS
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