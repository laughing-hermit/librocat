#!/bin/sh
# First run of self-hosted librocat: generate the secrets into .env (kept
# across runs), start the Convex backend, take its admin key, then build and
# start the rest. Safe to run again. COMPOSE picks the tool (default:
# "docker compose"; "podman compose" works too).
set -eu
cd "$(dirname "$0")"
COMPOSE=${COMPOSE:-docker compose}
# First run: .env starts from the template, with the model first.
[ -e .env ] || cp .env.example .env
chmod 600 .env
has() { grep -q "^$1=" .env; }
has CONVEX_INSTANCE_SECRET || echo "CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)" >> .env
has BETTER_AUTH_SECRET || echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
# The admin key is derived from the instance secret, so it can only be made
# once the backend runs; until then a placeholder satisfies compose, which
# checks the whole file on every command.
has CONVEX_ADMIN_KEY || export CONVEX_ADMIN_KEY=pending
$COMPOSE up -d convex
echo "Waiting for Convex..."
tries=0
until $COMPOSE exec -T convex curl -sf http://localhost:3210/version >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 120 ]; then
    echo "Convex did not start: see $COMPOSE logs convex" >&2
    exit 1
  fi
  sleep 1
done
if [ "${CONVEX_ADMIN_KEY:-}" = pending ]; then
  key=$($COMPOSE exec -T convex ./generate_admin_key.sh | tail -n 1 | tr -d '\r')
  echo "CONVEX_ADMIN_KEY=$key" >> .env
  unset CONVEX_ADMIN_KEY # from here on, compose reads it from .env
fi
$COMPOSE up -d --build
echo
site=$(grep '^LIBROCAT_SITE_URL=' .env | cut -d= -f2- || true)
echo "librocat is starting at ${site:-http://localhost:3000} (the MCP at /mcp)."
echo "Follow the deploy with: $COMPOSE logs -f deploy"
if ! grep -qE '^(AI_GATEWAY_API_KEY|TYPESAFE_API_KEY|LIBROCAT_JEV_URL)=.' .env; then
  echo
  echo "No model is set, so librocat runs without one: agents write complete"
  echo "concepts, and search works the same (it goes by words). It works best"
  echo "with Jev, or another System One model, for cataloging and Libro's"
  echo "screens, online or offline: see Models in .env."
fi
echo "Check the model with ./models.sh."
