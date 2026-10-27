#!/bin/sh
# Push librocat's Convex functions to the self-hosted backend, with what they
# read set first (Convex checks the auth config's SITE_URL on deploy).
# CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY name the backend.
# Runs on every `docker compose up`, so an upgrade deploys the new functions.
set -eu
cd /app/apps/web
convex() { node_modules/.bin/convex "$@"; }
convex env set SITE_URL "$SITE_URL"
convex env set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
convex env set LIBROCAT_SELF_HOST 1
if [ -n "${AUTH_RESEND_KEY:-}" ]; then
  convex env set AUTH_RESEND_KEY "$AUTH_RESEND_KEY"
  convex env remove AUTH_DEV_LOG_CODES >/dev/null 2>&1 || true
else
  # No email service: sign-up and password codes go to the function log.
  convex env set AUTH_DEV_LOG_CODES 1
fi
# The model (SELF_HOSTING.md, Models): each setting in .env is set on the
# deployment, and one taken out of .env is removed from it.
for name in AI_GATEWAY_API_KEY TYPESAFE_API_KEY LIBROCAT_JEV LIBROCAT_JEV_URL LIBROCAT_JEV_KEY \
  LIBROCAT_EVAL_MODEL LIBROCAT_FETCH_PRIVATE; do
  eval "value=\${$name:-}"
  if [ -n "$value" ]; then
    convex env set "$name" "$value"
  else
    convex env remove "$name" >/dev/null 2>&1 || true
  fi
done
# The embedding model's settings, from before search went by words alone:
# removed from the deployment if an older version set them.
for name in $(convex env list --names-only 2>/dev/null | grep '^LIBROCAT_EMBED_' || true); do
  convex env remove "$name" >/dev/null 2>&1 || true
done
convex deploy --yes --typecheck disable
# Data changes a new version needs (convex/migrations.ts); each does only what's left.
convex run migrations:backfillStems >/dev/null
convex run migrations:backfillTextBytes >/dev/null
convex run migrations:indexCatalog >/dev/null
convex run migrations:pruneUnattached >/dev/null
convex run migrations:indexPaths >/dev/null
convex run migrations:dropSearchText >/dev/null
# Search goes by words alone: each kept source gets its title indexed.
convex run migrations:indexSourceTitles >/dev/null
echo "librocat's functions are deployed."
# What runs the model, or why it's off; ./models.sh also calls it.
echo "Models (SELF_HOSTING.md, Models):"
convex run probe:models '{"calls": false}' || echo "(not read: run ./models.sh)"
