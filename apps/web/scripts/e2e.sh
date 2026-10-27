#!/usr/bin/env bash
# Every e2e suite in one pass, on a throwaway local stack: a git
# worktree of REF (default HEAD) with its own install, an anonymous local
# Convex backend, the fake AI Gateway (tests/fake-gateway.ts), and
# `next dev`. The worktree leaves this checkout's apps/web/.env.local
# alone. Everything stops and the worktree goes when the run ends; the logs
# stay unless every suite passes. docs/cloud.md §Local development has the
# same steps by hand.
#   pnpm run e2e                  # HEAD: a worktree sees commits only
#   pnpm run e2e origin/<branch>  # a pull request's branch, after git fetch
#   E2E_SERVE=1 pnpm run e2e      # start the stack and keep it up, for a bug
#                                 # bash (browser/README.md); Ctrl-C stops it
# The browser suite (browser/, TesterArmy's e2e) uses exact steps only, so
# it calls no model and needs no token: it runs with --strict-cache, and an
# agent step added to it fails instead of reaching a model. Agents are for
# the bug bash (`e2e explore`, browser/README.md).
# Needs ports 3210, 3211 and 8787 free, and one of 3000, 3100, 3200 or 3300
# for the site (another app's dev server often holds 3000).
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ref=${1:-HEAD}
commit=$(git -C "$repo" rev-parse --verify --quiet "$ref^{commit}") || {
  echo "e2e: no commit named $ref" >&2
  exit 2
}
# Taken on either loopback address: a dev server may listen on ::1 only.
taken() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null; }
for port in 3210 3211 8787; do
  if taken "$port"; then
    echo "e2e: port $port is in use; stop what holds it first" >&2
    exit 2
  fi
done
site_port=""
for port in 3000 3100 3200 3300; do
  if ! taken "$port"; then
    site_port=$port
    break
  fi
done
if [ -z "$site_port" ]; then
  echo "e2e: ports 3000, 3100, 3200 and 3300 are all in use; free one for the site" >&2
  exit 2
fi
site="http://localhost:$site_port"

logs=$(mktemp -d "${TMPDIR:-/tmp}/librocat-e2e.XXXXXX")
tree="$logs/tree"
pids=()
failed=1
# PID and every process below it: what one service started, and nothing else.
tree_of() {
  local all p c
  local queue=("$1") out=()
  all=$(ps -eo pid=,ppid=)
  while [ "${#queue[@]}" -gt 0 ]; do
    p=${queue[0]}
    queue=("${queue[@]:1}")
    out+=("$p")
    for c in $(awk -v p="$p" '$2 == p { print $1 }' <<<"$all"); do queue+=("$c"); done
  done
  echo "${out[@]}"
}
stop() {
  # Only what this run started: a port can change hands while it runs.
  for pid in ${pids[@]+"${pids[@]}"}; do
    # shellcheck disable=SC2046
    kill -TERM $(tree_of "$pid") 2>/dev/null || true
  done
  git -C "$repo" worktree remove --force "$tree" 2>/dev/null || true
  git -C "$repo" worktree prune
  if [ "$failed" -eq 0 ]; then rm -rf "$logs"; else echo "e2e: logs in $logs" >&2; fi
}
trap stop EXIT

# start NAME COMMAND...: run a service in the background, its output in NAME.log.
start() {
  local name=$1
  shift
  "$@" >"$logs/$name.log" 2>&1 &
  pids+=("$!")
}
# wait_for SECONDS WHAT COMMAND...: poll until COMMAND succeeds.
wait_for() {
  local deadline=$((SECONDS + $1)) what=$2
  shift 2
  until "$@" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "e2e: timed out waiting for $what" >&2
      exit 1
    fi
    sleep 1
  done
}

echo "e2e: $(git -C "$repo" log --oneline -1 "$commit")"
git -C "$repo" worktree add --quiet --detach "$tree" "$commit"
(cd "$tree" && pnpm install --frozen-lockfile --prefer-offline) >"$logs/install.log" 2>&1 || {
  echo "e2e: pnpm install failed, see install.log" >&2
  exit 1
}

# The anonymous deployment keeps its state in the worktree's apps/web/.convex,
# so every run starts from an empty one and leaves nothing behind.
cd "$tree/apps/web"
export CONVEX_AGENT_MODE=anonymous
convex() { node_modules/.bin/convex "$@" >>"$logs/cli.log" 2>&1; }
start convex node_modules/.bin/convex dev --typecheck=disable
wait_for 300 "the local Convex backend" curl -sf http://127.0.0.1:3210/version
wait_for 60 "the local deployment in .env.local" grep -q '^CONVEX_DEPLOYMENT=' .env.local
convex env set SITE_URL "$site"
convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
convex env set AUTH_DEV_LOG_CODES 1
convex env set LIBROCAT_E2E 1
convex env set LIBROCAT_AI_GATEWAY_URL http://127.0.0.1:8787/v1
convex env set AI_GATEWAY_API_KEY test
# The reading list and source watch fetch a test page this process serves.
convex env set LIBROCAT_FETCH_PRIVATE 1
# The first push stopped on the missing SITE_URL: push again.
offset=$(wc -c <"$logs/convex.log")
touch convex/schema.ts
# grep without -q reads to the end, so pipefail never sees a broken pipe.
pushed() { tail -c +"$((offset + 1))" "$logs/convex.log" | grep 'Convex functions ready'; }
wait_for 120 "the Convex functions" pushed

start fake-gateway node tests/fake-gateway.ts
start next node_modules/.bin/next dev -p "$site_port"
wait_for 60 "the fake gateway" curl -s -o /dev/null http://127.0.0.1:8787/
wait_for 180 "next dev" curl -sf -o /dev/null "$site/"
# The site that answers must be this one, not an app that took the port meanwhile.
ours() { curl -sf "$site/.well-known/oauth-protected-resource/mcp" | grep "\"$site/mcp\""; }
if ! ours >/dev/null 2>&1; then
  echo "e2e: another app answers on port $site_port; stop it, and run again" >&2
  exit 1
fi
echo "e2e: the site is $site"

export LIBROCAT_E2E_CLI_CWD="$tree/apps/web" LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210
export LIBROCAT_E2E_SITE_URL="$site"
# Emailed codes go to the Convex log here (AUTH_DEV_LOG_CODES): the browser
# suite reads them from it.
export LIBROCAT_E2E_CONVEX_LOG="$logs/convex.log" E2E_TELEMETRY_DISABLED=1
mcp="$site/mcp"

if [ "${E2E_SERVE:-}" = "1" ]; then
  echo "e2e: serving $site (Convex http://127.0.0.1:3210, logs in $logs); Ctrl-C stops it"
  echo "e2e: in $tree/apps/web, with LIBROCAT_E2E_CLI_CWD=$tree/apps/web LIBROCAT_E2E_SITE_URL=$site LIBROCAT_E2E_CONVEX_LOG=$logs/convex.log"
  failed=0
  wait
  exit 0
fi
status=0
# suite NAME VAR=VALUE...: one test file in apps/web/tests; a skipped test
# counts as a failure, since it means a variable is missing.
suite() {
  local name=$1 dir=apps/web code=0 tests mark=ok
  shift
  (cd "$tree/$dir" && env "$@" pnpm exec vitest run "tests/$name.e2e.test.ts") >"$logs/$name.log" 2>&1 ||
    code=$?
  tests=$(grep -E '^ +Tests ' "$logs/$name.log" | sed 's/^ *Tests *//' || true)
  if [ "$code" -ne 0 ] || [ -z "$tests" ] || grep -qE 'failed|skipped' <<<"$tests"; then
    mark=FAIL
    status=1
  fi
  printf 'e2e: %-4s %-9s %s\n' "$mark" "$name" "${tests:-no result, see $name.log}"
}
suite reference LIBROCAT_FAKE_GATEWAY=1
suite libro LIBROCAT_FAKE_GATEWAY=1
token=$(node_modules/.bin/convex run dev:issueTestAccessToken '{"plan":"individual"}' 2>>"$logs/cli.log" |
  node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).token')
suite mcp LIBROCAT_MCP_URL="$mcp" LIBROCAT_FAKE_GATEWAY=1 LIBROCAT_MCP_TOKEN="$token"
suite limits LIBROCAT_FAKE_GATEWAY=1
suite probe LIBROCAT_FAKE_GATEWAY=1
suite account LIBROCAT_MCP_URL="$mcp"
# The browser suite: the app in Chromium, as a person uses it.
browser_suite() {
  local code=0 tests mark=ok
  (cd "$tree/apps/web" && pnpm exec e2e run --strict-cache --target desktop --exclude-tag bugbash,screens --reporter list) \
    >"$logs/browser.log" 2>&1 || code=$?
  tests=$(grep -E '^ *Tests ' "$logs/browser.log" | tail -1 | sed 's/^ *Tests *//' || true)
  if [ "$code" -ne 0 ] || [ -z "$tests" ]; then
    mark=FAIL
    status=1
  fi
  printf 'e2e: %-4s %-9s %s\n' "$mark" browser "${tests:-no result, see browser.log}"
}
browser_suite

# The dashboard suite expects no cataloging, so the gateway key goes first.
convex env remove AI_GATEWAY_API_KEY
suite dashboard
suite oauth LIBROCAT_MCP_URL="$mcp"

failed=$status
if [ "$status" -eq 0 ]; then echo "e2e: every suite passed"; fi
exit "$status"
