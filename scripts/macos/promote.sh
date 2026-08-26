#!/bin/zsh
# promote.sh — dev-verified promote with drain and auto-rollback (spec B6).
#
# Flow: full build (dev-scoped: dist-dev + dist-server-dev) → server test
# suite → boot the dev instance on the fresh build and health-check it →
# drain live's in-flight dispatched turns (wait for the commit gate; past the
# wait budget it becomes a decision-needed notification and the promote
# aborts) → copy artifacts into live's dist/ + dist-server/ → restart live
# via launchd → post-promote health check → on success advance the last-good
# artifact snapshot and the mini-last-good git tag; on failure restore the
# last-good artifacts, restart live back to health, and fire decision-needed.
#
# The tag has a guard (ui14 job 9): mini-last-good never lands on a commit a
# running chain is still building. `promote --tag-guard` runs only that check
# against the watchdog (PROMOTE_SERVER_URL / PROMOTE_DB_PATH pick the
# instance) and exits 0 when the tag would be allowed, 2 when refused.
set -u

REPO="${CLOUDCLI_REPO:-$HOME/Projects/cloudcli}"
SERVER_URL="${PROMOTE_SERVER_URL:-http://127.0.0.1:4747}"
DEV_URL="http://127.0.0.1:4748"
SNAPSHOT_DIR="$REPO/.last-good"
DRAIN_BUDGET_S="${PROMOTE_DRAIN_BUDGET_S:-1800}"
UID_NUM=$(id -u)
DB_PATH="${PROMOTE_DB_PATH:-$HOME/.cloudcli/auth.db}"

log() { print -r -- "[promote $(date +%H:%M:%S)] $*"; }
fail() { log "ABORT: $*"; exit 1; }

API_KEY=$(/usr/bin/sqlite3 "$DB_PATH" "SELECT api_key FROM api_keys WHERE is_active=1 ORDER BY id LIMIT 1" 2>/dev/null)
HEADER_FILE=$(mktemp); chmod 600 "$HEADER_FILE"
print -r -- "header = \"x-api-key: $API_KEY\"" > "$HEADER_FILE"
trap 'rm -f "$HEADER_FILE"' EXIT

notify() {
  curl -s -K "$HEADER_FILE" -m 15 -X POST "$SERVER_URL/api/watchdog/notify" \
    -H 'Content-Type: application/json' \
    -d "{\"kind\":\"$1\",\"title\":\"$2\",\"body\":\"$3\"}" >/dev/null 2>&1 || true
}

health() { curl -s -m 5 "$1/health" | grep -q '"status":"ok"'; }

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

if [[ "${1:-}" == "--tag-guard" ]]; then
  if tag_guard; then log "tag guard: HEAD $(git rev-parse --short HEAD) may be tagged"; exit 0; fi
  exit 2
fi

log "building (client + server)"
npm run build >/tmp/promote-build.log 2>&1 || fail "build failed; see /tmp/promote-build.log"

log "running server test suite"
npm test >/tmp/promote-test.log 2>&1 || fail "tests failed; see /tmp/promote-test.log"

log "verifying the fresh build on dev (4748)"
launchctl kickstart -k "gui/$UID_NUM/com.spoton.cloudcli-dev" || fail "could not start dev"
DEV_OK=0
for i in {1..12}; do
  sleep 5
  if health "$DEV_URL"; then DEV_OK=1; break; fi
done
[[ $DEV_OK -eq 1 ]] || fail "dev instance failed its health check on the new build"
log "dev healthy on the new build"

# Chains run out-of-process and survive the restart (their runner re-registers
# with the watchdog via its events), so only in-server dispatched runs drain.
log "draining live's in-flight dispatched turns (budget ${DRAIN_BUDGET_S}s)"
WAITED=0
while true; do
  BUSY=$(curl -s -K "$HEADER_FILE" -m 10 "$SERVER_URL/api/watchdog/status" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)['data']
    runs=[r for r in d.get('dispatchRuns',[]) if not r.get('ended')]
    print(len(runs))
except Exception:
    print(0)")
  [[ "$BUSY" == 0 ]] && break
  if [[ $WAITED -ge $DRAIN_BUDGET_S ]]; then
    notify decision-needed "Promote is blocked on in-flight dispatched work" \
      "Dispatched turns are still running after ${DRAIN_BUDGET_S}s of draining. Promote aborted; re-run when the chain reaches its commit gate or stop it deliberately."
    fail "drain budget exceeded with $BUSY dispatched item(s) still running"
  fi
  log "  $BUSY dispatched item(s) in flight; waiting"
  sleep 30; WAITED=$((WAITED + 30))
done
log "live is drained"

# Build isolation (ui9 A1): npm run build emits dev-scoped artifacts
# (dist-dev, dist-server-dev). Live serves only dist/ and dist-server/, and
# this copy is the single place they are ever written.
log "copying verified artifacts into live's serving location"
rsync -a --delete "$REPO/dist-dev/" "$REPO/dist/" || fail "artifact copy (frontend) failed"
rsync -a --delete "$REPO/dist-server-dev/" "$REPO/dist-server/" || fail "artifact copy (server) failed"

log "restarting live on the new build"
launchctl kickstart -k "gui/$UID_NUM/com.spoton.cloudcli-live"

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
  if tag_guard; then
    git -C "$REPO" tag -f mini-last-good HEAD >/dev/null 2>&1 || true
    log "promote complete (mini-last-good -> $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
  else
    log "promote complete (mini-last-good withheld; re-run promote once the chain is between phases)"
  fi
  exit 0
fi

log "live FAILED its post-promote health check; rolling back to last-good artifacts"
if [[ -d "$SNAPSHOT_DIR/dist-server" ]]; then
  rm -rf "$REPO/dist" "$REPO/dist-server"
  cp -R "$SNAPSHOT_DIR/dist" "$REPO/dist"
  cp -R "$SNAPSHOT_DIR/dist-server" "$REPO/dist-server"
  launchctl kickstart -k "gui/$UID_NUM/com.spoton.cloudcli-live"
  ROLLBACK_OK=0
  for i in {1..12}; do
    sleep 5
    if health "$SERVER_URL"; then ROLLBACK_OK=1; break; fi
  done
  if [[ $ROLLBACK_OK -eq 1 ]]; then
    notify decision-needed "Promote rolled back" \
      "The new build failed its health check. Live was rolled back to the last-good artifacts (tag mini-last-good) and is healthy. Dev stays up on the bad build for diagnosis."
    log "rollback succeeded; live healthy on last-good artifacts"
    exit 3
  fi
fi

notify decision-needed "Promote failed and rollback did not recover" \
  "Live is unhealthy after a failed promote and the last-good rollback did not bring it back. SSH to the mini or use Parsec."
fail "rollback failed; live remains unhealthy"
