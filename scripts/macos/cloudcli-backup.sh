#!/bin/zsh
# Nightly backup of the mini's session history and CloudCLI state (spec A9).
# Tarballs ~/.claude (transcripts, config) and ~/.cloudcli (DB, assets, push
# subscriptions) into ~/backups/cloudcli-nightly/, rotates to the last 7, then
# delivers the newest archive off-mini via Taildrop to the first reachable
# fleet target. The local archive is kept either way, so a night with the whole
# fleet offline still produces a restorable backup; delivery is retried the
# next night by design.
set -u

STAMP=$(date +%Y%m%d-%H%M%S)
DEST_DIR="$HOME/backups/cloudcli-nightly"
LOG="$HOME/forge-logs/cloudcli-backup/backup.log"
FLEET_TARGETS=(silo desktop-2vr4mlt-1)
TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
[[ -x "$TAILSCALE" ]] || TAILSCALE=$(command -v tailscale)

mkdir -p "$DEST_DIR" "${LOG:h}"
log() { print -r -- "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" >> "$LOG"; }

ARCHIVE="$DEST_DIR/mini-backup-$STAMP.tar.gz"
# --exclude keeps transient/regenerable trees out; transcripts and DBs are the payload.
tar -czf "$ARCHIVE" \
    --exclude '.claude/ccsync/node_modules' \
    --exclude '.claude/shell-snapshots' \
    -C "$HOME" .claude .cloudcli 2>> "$LOG"
RC=$?
if [[ $RC -ne 0 && ! -s "$ARCHIVE" ]]; then
    log "tarball FAILED rc=$RC"
    exit 1
fi
log "tarball ok: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Rotate: keep the 7 newest local archives.
ls -t "$DEST_DIR"/mini-backup-*.tar.gz 2>/dev/null | tail -n +8 | while read -r OLD; do
    rm -f "$OLD" && log "rotated out $OLD"
done

# Off-mini delivery: Taildrop to the first fleet machine that answers.
for T in "${FLEET_TARGETS[@]}"; do
    if "$TAILSCALE" ping -c 1 --timeout 5s "$T" >/dev/null 2>&1; then
        if "$TAILSCALE" file cp "$ARCHIVE" "$T:" >> "$LOG" 2>&1; then
            log "delivered to $T"
            exit 0
        fi
        log "taildrop to $T failed; trying next target"
    fi
done
log "no fleet target reachable; archive retained locally only"
exit 0
