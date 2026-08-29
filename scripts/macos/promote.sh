#!/bin/zsh
# promote.sh — dev-verified promote with drain and auto-rollback (spec B6).
#
# Flow: full build (dev-scoped: dist-dev + dist-server-dev) → server test
# suite → boot the dev instance on the fresh build and health-check it →
# hold this project's running chains at their next clean unit boundary →
# drain live's
# in-flight dispatched turns (past the
# wait budget it becomes a decision-needed notification and the promote
# aborts) → copy artifacts into live's dist/ + dist-server/ → restart live
# via launchd → post-promote health check → on success advance the last-good
# artifact snapshot and the mini-last-good git tag → resume every chain;
# on failure restore the last-good artifacts, restart live back to health,
# resume every chain, and fire decision-needed.
#
# The tag has a guard (ui14 job 9): mini-last-good never lands on a commit a
# running chain is still building. `promote --tag-guard` runs only that check
# against the watchdog (PROMOTE_SERVER_URL / PROMOTE_DB_PATH pick the
# instance) and exits 0 when the tag would be allowed, 2 when refused.
set -u

SCRIPT_DIR="${0:A:h}"
NODE=$(command -v node || echo /usr/local/bin/node)
eval "$("$NODE" "$SCRIPT_DIR/../../shared/runtime-anchors.js" --shell)"
CONFIGURED_REPO=$("$NODE" "$SCRIPT_DIR/../../shared/runtime-anchors.js" --environment REPO)
REPO="${CONFIGURED_REPO:-$COMMAND_CENTER_RUNTIME_PROJECT_DIR}"
DEV_URL="${PROMOTE_DEV_URL:-http://127.0.0.1:4748}"
SNAPSHOT_DIR="$REPO/.last-good"
DRAIN_BUDGET_S="${PROMOTE_DRAIN_BUDGET_S:-1800}"
HOLD_POLL_S="${PROMOTE_HOLD_POLL_S:-5}"
UID_NUM=$(id -u)
DEV_LAUNCHD_LABEL="$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-dev"
LIVE_LAUNCHD_LABEL="$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-live"
DISPATCH_PATH="${PROMOTE_DISPATCH_PATH:-$SCRIPT_DIR/dispatch}"
DRY_RUN=0

case "${1:-}" in
  "") ;;
  --tag-guard) ;;
  --dry-run) DRY_RUN=1 ;;
  *) print -u2 "usage: promote.sh [--tag-guard|--dry-run]"; exit 64 ;;
esac

if [[ $DRY_RUN -eq 1 ]]; then
  # A dry run is deliberately isolated to dev: it exercises real watchdog
  # hold/resume state without touching live artifacts or launchd services.
  SERVER_URL="${PROMOTE_SERVER_URL:-$DEV_URL}"
  DB_PATH="${PROMOTE_DB_PATH:-$COMMAND_CENTER_RUNTIME_DEV_DATA_DIR/auth.db}"
else
  SERVER_URL="${PROMOTE_SERVER_URL:-http://127.0.0.1:4747}"
  DB_PATH="${PROMOTE_DB_PATH:-$COMMAND_CENTER_RUNTIME_DATA_DIR/auth.db}"
fi

log() { print -r -- "[promote $(date +%H:%M:%S)] $*"; }
fail() { log "ABORT: $*"; exit 1; }

API_KEY=$(/usr/bin/sqlite3 "$DB_PATH" "SELECT api_key FROM api_keys WHERE is_active=1 ORDER BY id LIMIT 1" 2>/dev/null)
[[ -n "$API_KEY" ]] || fail "no active API key in $DB_PATH"
HEADER_FILE=$(mktemp); chmod 600 "$HEADER_FILE"
print -r -- "header = \"x-api-key: $API_KEY\"" > "$HEADER_FILE"

typeset -a MANAGED_CHAINS
MANAGED_CHAINS=()

notify() {
  local body
  body=$(python3 - "$1" "$2" "$3" <<'PYEOF'
import json, sys
kind, title, message = sys.argv[1:4]
print(json.dumps({'kind': kind, 'title': title, 'body': message}))
PYEOF
)
  curl -s -K "$HEADER_FILE" -m 15 -X POST "$SERVER_URL/api/watchdog/notify" \
    -H 'Content-Type: application/json' \
    -d "$body" >/dev/null 2>&1 || true
}

record_promote() {
  local body attempt=1
  body=$(python3 - "$REPO" "$PROMOTED_COMMIT" "$PREVIOUS_LIVE_COMMIT" "$DRY_RUN" <<'PYEOF'
import json, sys
project, promoted, previous, dry_run = sys.argv[1:5]
print(json.dumps({
    'kind': 'promoted',
    'projectPath': project,
    'promotedCommit': promoted,
    'previousLiveCommit': previous,
    'dryRun': dry_run == '1',
}))
PYEOF
)
  while [[ $attempt -le 3 ]]; do
    if curl -sf -K "$HEADER_FILE" -m 15 -X POST "$SERVER_URL/api/watchdog/notify" \
        -H 'Content-Type: application/json' -d "$body" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

health() { curl -s -m 5 "$1/health" | grep -q '"status":"ok"'; }

chain_journal() {
  local slug="$1" state="$2" journal_dir="$HOME/forge-logs/$slug"
  mkdir -p "$journal_dir" || return 1
  print -r -- "$(date +%H:%M) | run | $state | promote" >> "$journal_dir/JOURNAL.md"
}

# Releases the exact set this invocation asked to hold. A chain still in its
# unit keeps running after its flag is cleared; a chain already held delegates
# to the unchanged dispatch resume path and starts at its next unit.
release_held_chains() {
  local slug output reason failed=0
  typeset -a output_lines pending
  pending=("${MANAGED_CHAINS[@]}")
  MANAGED_CHAINS=()
  for slug in "${pending[@]}"; do
    if output=$(DISPATCH_SERVER_URL="$SERVER_URL" DISPATCH_DB_PATH="$DB_PATH" \
        "$DISPATCH_PATH" release-hold "$REPO" "$slug" 2>&1); then
      if [[ "$output" == *" resumed at job "* ]]; then
        chain_journal "$slug" RESUMED || {
          notify decision-needed "Promote could not journal resumed chain $slug" \
            "Chain $slug resumed, but promote could not append its RESUMED boundary to $HOME/forge-logs/$slug/JOURNAL.md."
          failed=1
        }
        log "chain $slug resumed after promote"
      else
        log "chain $slug hold cleared before its boundary"
      fi
    else
      output_lines=("${(@f)output}")
      reason="${output_lines[-1]:-dispatch release-hold exited without a reason}"
      notify decision-needed "Promote could not release chain $slug" \
        "Chain $slug kept its promote hold: $reason"
      log "chain $slug FAILED to release: $reason"
      failed=1
    fi
  done
  return $failed
}

# EXIT is the abort/failed-health/failed-rollback safety net. Successful and
# rollback paths release explicitly at their health boundary and empty the set.
on_exit() {
  local exit_code=$?
  trap - EXIT HUP INT TERM
  if [[ ${#MANAGED_CHAINS[@]} -gt 0 ]]; then
    log "promote is exiting; releasing ${#MANAGED_CHAINS[@]} held chain(s)"
    release_held_chains || { [[ $exit_code -ne 0 ]] || exit_code=1; }
  fi
  rm -f "$HEADER_FILE"
  exit $exit_code
}
trap on_exit EXIT
TRAPHUP() { exit 129; }
TRAPINT() { exit 130; }
TRAPTERM() { exit 143; }

# Finds every running chain for this physical repo, then records a durable
# promote hold through dispatch. No process is signaled or interrupted.
hold_running_chains() {
  local listing slug output repo_real
  typeset -a output_lines running
  repo_real="$(cd "$REPO" && pwd -P)"
  listing=$(curl -sf -K "$HEADER_FILE" -m 10 "$SERVER_URL/api/watchdog/status" \
    | REPO_REAL="$repo_real" python3 -c '
import json, os, sys
repo = os.environ["REPO_REAL"]
try:
    data = json.load(sys.stdin)["data"]
except Exception as error:
    print(f"watchdog status unreadable: {error}", file=sys.stderr)
    raise SystemExit(65)
for chain in data.get("chains", []):
    project = chain.get("projectPath")
    if chain.get("status") == "running" and project and os.path.realpath(project) == repo:
        print(chain["slug"])
') || fail "could not read running chains from $SERVER_URL"
  running=("${(@f)listing}")
  [[ -n "$listing" ]] || { log "no running chains for $repo_real"; return 0; }
  for slug in "${running[@]}"; do
    if ! output=$(DISPATCH_SERVER_URL="$SERVER_URL" DISPATCH_DB_PATH="$DB_PATH" \
        "$DISPATCH_PATH" hold "$REPO" "$slug" 2>&1); then
      output_lines=("${(@f)output}")
      fail "could not hold chain $slug: ${output_lines[-1]:-dispatch hold exited without a reason}"
    fi
    if [[ "$output" == *"will hold after"* ]]; then
      MANAGED_CHAINS+=("$slug")
      log "chain $slug will hold at its next clean boundary"
    elif [[ "$output" == *"nothing changed"* ]]; then
      log "chain $slug reached a non-running state before promote could hold it"
    else
      fail "dispatch hold returned an unrecognized result for chain $slug: $output"
    fi
  done
}

wait_for_held_chains() {
  local waited=0 snapshot counts held pending invalid expected
  [[ ${#MANAGED_CHAINS[@]} -gt 0 ]] || return 0
  expected="${(j:,:)MANAGED_CHAINS}"
  log "waiting for ${#MANAGED_CHAINS[@]} chain(s) to reach clean boundaries (budget ${DRAIN_BUDGET_S}s)"
  while true; do
    snapshot=$(curl -sf -K "$HEADER_FILE" -m 10 "$SERVER_URL/api/watchdog/status") \
      || fail "watchdog status became unreadable while waiting for chain holds"
    counts=$(RESPONSE_BODY="$snapshot" EXPECTED_SLUGS="$expected" python3 -c '
import json, os
data = json.loads(os.environ["RESPONSE_BODY"])["data"]
chains = {chain.get("slug"): chain for chain in data.get("chains", [])}
held = pending = 0
invalid = []
for slug in filter(None, os.environ["EXPECTED_SLUGS"].split(",")):
    chain = chains.get(slug)
    if chain and chain.get("status") == "paused" and chain.get("holdReason") == "promote":
        held += 1
    elif chain and chain.get("status") == "running" and chain.get("holdRequested") is True:
        pending += 1
    else:
        invalid.append(slug)
print(held, pending, ",".join(invalid))
') || fail "watchdog hold state was unreadable"
    read -r held pending invalid <<< "$counts"
    if [[ $held -eq ${#MANAGED_CHAINS[@]} ]]; then
      log "all managed chains are held at clean boundaries"
      return 0
    fi
    if [[ -n "$invalid" ]]; then
      release_held_chains
      notify decision-needed "Promote could not hold every running chain" \
        "Chain state changed unexpectedly while waiting for promote: $invalid. Promote aborted without touching live; all promote holds were released."
      fail "chain state changed before every hold landed: $invalid"
    fi
    if [[ $waited -ge $DRAIN_BUDGET_S ]]; then
      release_held_chains
      notify decision-needed "Promote timed out waiting for a clean unit boundary" \
        "One or more chains did not finish their current job within ${DRAIN_BUDGET_S}s. Promote aborted without touching live; their holds were cleared and work keeps running."
      fail "hold budget exceeded with $pending chain(s) still finishing their current unit"
    fi
    sleep "$HOLD_POLL_S"
    waited=$((waited + HOLD_POLL_S))
  done
}

drain_dispatch_runs() {
  local waited=0 busy
  log "draining in-flight dispatched turns (budget ${DRAIN_BUDGET_S}s)"
  while true; do
    busy=$(curl -s -K "$HEADER_FILE" -m 10 "$SERVER_URL/api/watchdog/status" | python3 -c "
import json,sys
try:
    data=json.load(sys.stdin)['data']
    runs=[run for run in data.get('dispatchRuns',[]) if not run.get('ended')]
    print(len(runs))
except Exception:
    raise SystemExit(65)") || fail "watchdog status became unreadable while draining"
    [[ "$busy" == 0 ]] && break
    if [[ $waited -ge $DRAIN_BUDGET_S ]]; then
      notify decision-needed "Promote is blocked on in-flight dispatched work" \
        "Dispatched turns are still running after ${DRAIN_BUDGET_S}s of draining. Promote aborted; its held chains are being resumed."
      fail "drain budget exceeded with $busy dispatched item(s) still running"
    fi
    log "  $busy dispatched item(s) in flight; waiting"
    sleep 30
    waited=$((waited + 30))
  done
  log "dispatch runs drained"
}

# Tag guard: HEAD is safe to tag only when no chain on this repo has a phase
# mid-flight (phase-start seen, no phase-end yet) and no in-server dispatched
# run is still open. A between-phases chain is fine: HEAD is its last
# committed unit. Unreadable status refuses; a guard that cannot see the
# chain state must not tag.
tag_guard() {
  local verdict
  verdict=$(curl -s -K "$HEADER_FILE" -m 10 "$SERVER_URL/api/watchdog/status" | REPO_REAL="$(cd "$REPO" && pwd -P)" python3 -c '
import json, os, sys
repo = os.environ["REPO_REAL"]
def same(p):
    return bool(p) and os.path.realpath(p) == repo
try:
    d = json.load(sys.stdin)["data"]
except Exception:
    print("watchdog status unreadable"); sys.exit(0)
live = [c["slug"] for c in d.get("chains", []) if c.get("status") == "running" and c.get("phaseActive") and same(c.get("projectPath"))]
open_runs = [r for r in d.get("dispatchRuns", []) if not r.get("ended") and same(r.get("projectPath"))]
if live:
    print("chain " + ", ".join(live) + " has a phase mid-flight")
elif open_runs:
    print(str(len(open_runs)) + " dispatched run(s) still open")
else:
    print("ok")
')
  [[ "$verdict" == ok ]] && return 0
  log "tag guard refused mini-last-good: $verdict"
  return 1
}

cd "$REPO" || fail "repo missing"
PROMOTED_COMMIT=$(git rev-parse HEAD 2>/dev/null) || fail "could not resolve the promoted commit"
PREVIOUS_LIVE_COMMIT=$(git rev-parse mini-last-good 2>/dev/null \
  || git rev-parse HEAD 2>/dev/null) || fail "could not resolve the previous live commit"

if [[ "${1:-}" == "--tag-guard" ]]; then
  if tag_guard; then log "tag guard: HEAD $(git rev-parse --short HEAD) may be tagged"; exit 0; fi
  exit 2
fi

if [[ $DRY_RUN -eq 1 ]]; then
  log "dry run against dev: holding running chains at clean boundaries without building or restarting"
  hold_running_chains
  [[ "${PROMOTE_DRY_RUN_FAIL_AT:-}" != after-hold && "${PROMOTE_DRY_RUN_FAIL_AT:-}" != after-pause ]] \
    || fail "injected dry-run abort after hold request"
  wait_for_held_chains
  drain_dispatch_runs
  health "$SERVER_URL" || fail "dry-run dev health check failed"
  log "dry-run dev health check passed"
  record_promote || fail "could not record the completed dry-run promote"
  release_held_chains || fail "one or more chains failed to resume after the dry run"
  log "dry run complete"
  exit 0
fi

log "building (client + server)"
npm run build >/tmp/promote-build.log 2>&1 || fail "build failed; see /tmp/promote-build.log"

log "running server test suite"
npm test >/tmp/promote-test.log 2>&1 || fail "tests failed; see /tmp/promote-test.log"

log "verifying the fresh build on dev (4748)"
launchctl kickstart -k "gui/$UID_NUM/$DEV_LAUNCHD_LABEL" || fail "could not start dev"
DEV_OK=0
for i in {1..12}; do
  sleep 5
  if health "$DEV_URL"; then DEV_OK=1; break; fi
done
[[ $DEV_OK -eq 1 ]] || fail "dev instance failed its health check on the new build"
log "dev healthy on the new build"

hold_running_chains
wait_for_held_chains
drain_dispatch_runs

# Build isolation (ui9 A1): npm run build emits dev-scoped artifacts
# (dist-dev, dist-server-dev). Live serves only dist/ and dist-server/, and
# this copy is the single place they are ever written.
log "copying verified artifacts into live's serving location"
rsync -a --delete "$REPO/dist-dev/" "$REPO/dist/" || fail "artifact copy (frontend) failed"
rsync -a --delete "$REPO/dist-server-dev/" "$REPO/dist-server/" || fail "artifact copy (server) failed"

log "restarting live on the new build"
launchctl kickstart -k "gui/$UID_NUM/$LIVE_LAUNCHD_LABEL"

LIVE_OK=0
for i in {1..12}; do
  sleep 5
  if health "$SERVER_URL"; then LIVE_OK=1; break; fi
done

if [[ $LIVE_OK -eq 1 ]]; then
  log "live healthy post-promote; advancing last-good"
  rm -rf "$SNAPSHOT_DIR"
  mkdir -p "$SNAPSHOT_DIR"
  cp -R "$REPO/dist" "$SNAPSHOT_DIR/dist"
  cp -R "$REPO/dist-server" "$SNAPSHOT_DIR/dist-server"
  tag_guard || fail "tag guard refused after promotion held the project's chains and drained dispatched work"
  git -C "$REPO" tag -f mini-last-good HEAD >/dev/null 2>&1 \
    || fail "could not advance mini-last-good"
  record_promote || fail "could not record the completed promote"
  release_held_chains || fail "one or more chains failed to resume after the healthy promote"
  log "promote complete (mini-last-good -> $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
  exit 0
fi

log "live FAILED its post-promote health check; rolling back to last-good artifacts"
if [[ -d "$SNAPSHOT_DIR/dist-server" ]]; then
  rm -rf "$REPO/dist" "$REPO/dist-server"
  cp -R "$SNAPSHOT_DIR/dist" "$REPO/dist"
  cp -R "$SNAPSHOT_DIR/dist-server" "$REPO/dist-server"
  launchctl kickstart -k "gui/$UID_NUM/$LIVE_LAUNCHD_LABEL"
  ROLLBACK_OK=0
  for i in {1..12}; do
    sleep 5
    if health "$SERVER_URL"; then ROLLBACK_OK=1; break; fi
  done
  if [[ $ROLLBACK_OK -eq 1 ]]; then
    release_held_chains || fail "one or more chains failed to resume after rollback"
    notify decision-needed "Promote rolled back" \
      "The new build failed its health check. Live was rolled back to the last-good artifacts (tag mini-last-good) and is healthy. Dev stays up on the bad build for diagnosis."
    log "rollback succeeded; live healthy on last-good artifacts"
    exit 3
  fi
fi

notify decision-needed "Promote failed and rollback did not recover" \
  "Live is unhealthy after a failed promote and the last-good rollback did not bring it back. SSH to the mini or use Parsec."
fail "rollback failed; live remains unhealthy"
