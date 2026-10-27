#!/bin/sh
# Stream the Convex function log. With no email service (AUTH_RESEND_KEY
# unset), sign-up and password codes land here; so do errors. Arguments go
# to `convex logs` (for example --history 50).
set -eu
cd "$(dirname "$0")"
exec ${COMPOSE:-docker compose} run --rm --no-deps deploy \
  sh -c 'cd apps/web && exec node_modules/.bin/convex logs "$@"' logs "$@"
