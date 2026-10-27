#!/bin/sh
# Check librocat's model, the System One (Jev, or one of your own). It says
# what runs it, makes one small call to it, and says why the call failed if
# it did (SELF_HOSTING.md, Models). Run it after changing the model in .env
# and running docker compose up -d --build.
#   ./models.sh                  what runs it, and one call to it
#   ./models.sh '{"calls": false}'   what runs it, with no call
#   ./models.sh judge            how well the System One does librocat's jobs:
#                                librocat's own questions, right answers scored
#   ./models.sh files            whether pictures convert to JPEG and office
#                                documents are read (convex/fileProbe.ts)
set -eu
cd "$(dirname "$0")"
fn=probe:models
if [ "${1:-}" = judge ]; then
  fn=probe:judge
  shift
elif [ "${1:-}" = files ]; then
  fn=fileProbe:run
  shift
fi
exec ${COMPOSE:-docker compose} run --rm --no-deps deploy \
  sh -c 'cd apps/web && exec node_modules/.bin/convex run "$0" "$@"' "$fn" "$@"
