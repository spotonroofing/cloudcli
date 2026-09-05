#!/bin/zsh
# Dev/live service launcher: refresh dev's isolated CLAUDE_CONFIG_DIR credentials
# from the Keychain, then exec the selected server. This script owns log
# rotation for both launchd services: each process copy-truncates its out/err
# logs at 10 MiB, keeps three archives, and checks once per minute.
# The dev config dir needs its own .credentials.json because a non-default
# CLAUDE_CONFIG_DIR does not see the default Keychain login.
set -u

SCRIPT_DIR="${0:A:h}"
NODE=$(command -v node || echo /usr/local/bin/node)
eval "$("$NODE" "$SCRIPT_DIR/../../shared/runtime-anchors.js" --shell)"
CONFIGURED_REPO=$("$NODE" "$SCRIPT_DIR/../../shared/runtime-anchors.js" --environment REPO)

LOG_ROTATE_MAX_BYTES="${CLOUDCLI_LOG_ROTATE_MAX_BYTES:-10485760}"
LOG_ROTATE_KEEP="${CLOUDCLI_LOG_ROTATE_KEEP:-3}"
LOG_ROTATE_INTERVAL_SECS="${CLOUDCLI_LOG_ROTATE_INTERVAL_SECS:-60}"
[[ "$LOG_ROTATE_MAX_BYTES" == <1-> && "$LOG_ROTATE_KEEP" == <1-> && "$LOG_ROTATE_INTERVAL_SECS" == <1-> ]] \
    || { print -u2 "cloudcli service: log rotation settings must be positive integers"; exit 64; }

rotate_log() {
    local log="$1" lock="$1.rotate.lock" size archive
    [[ -f "$log" ]] || return 0
    size=$(stat -f %z "$log" 2>/dev/null) || return 0
    [[ $size -ge $LOG_ROTATE_MAX_BYTES ]] || return 0
    mkdir "$lock" 2>/dev/null || return 0
    rm -f "$log.$LOG_ROTATE_KEEP"
    archive=$((LOG_ROTATE_KEEP - 1))
    while [[ $archive -ge 1 ]]; do
        [[ -f "$log.$archive" ]] && mv "$log.$archive" "$log.$((archive + 1))"
        archive=$((archive - 1))
    done
    cp -p "$log" "$log.1"
    : > "$log"
    rmdir "$lock"
}

rotate_service_logs() {
    local log_dir="$1" instance="$2"
    mkdir -p "$log_dir"
    rotate_log "$log_dir/$instance.out.log"
    rotate_log "$log_dir/$instance.err.log"
}

if [[ "${1:-}" == "--rotate-logs-only" ]]; then
    [[ $# -eq 3 ]] || { print -u2 "usage: cloudcli-dev-start.sh --rotate-logs-only <log-dir> <dev|live>"; exit 64; }
    rotate_service_logs "$2" "$3"
    exit 0
fi

SERVICE_INSTANCE="${COMMAND_CENTER_INSTANCE:-dev}"
[[ "$SERVICE_INSTANCE" == "dev" || "$SERVICE_INSTANCE" == "live" ]] \
    || { print -u2 "cloudcli service: COMMAND_CENTER_INSTANCE must be dev or live"; exit 64; }
SERVICE_LOG_DIR="${CLOUDCLI_SERVICE_LOG_DIR:-$HOME/forge-logs/$COMMAND_CENTER_RUNTIME_SERVICE_LOG_DIR_NAME}"
rotate_service_logs "$SERVICE_LOG_DIR" "$SERVICE_INSTANCE"

# The rotator retains this PID when the shell execs Node, so it exits after
# the server does and does not accumulate across launchd restarts.
(
    while kill -0 $$ 2>/dev/null; do
        sleep "$LOG_ROTATE_INTERVAL_SECS"
        rotate_service_logs "$SERVICE_LOG_DIR" "$SERVICE_INSTANCE"
    done
) &

if [[ "$SERVICE_INSTANCE" == "dev" ]]; then
    DEV_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude-dev}"
    mkdir -p "$DEV_DIR/projects"

# The CLI looks up a config-dir-scoped Keychain service: for $HOME/.claude-dev
# it queries "Claude Code-credentials-fd736340" (suffix = the CLI's own hash of
# the config dir path; traced empirically — re-derive with a `security` PATH
# shim if the dev dir path ever changes). Mirror the default credentials there
# so dev sessions log in with whatever cswap has currently active.
    DEV_KEYCHAIN_SERVICE="Claude Code-credentials-fd736340"
    CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
    if [[ -n "$CREDS" ]]; then
        security add-generic-password -U -a "$USER" -s "$DEV_KEYCHAIN_SERVICE" -w "$CREDS" 2>/dev/null || true
        print -r -- "$CREDS" > "$DEV_DIR/.credentials.json"
        chmod 600 "$DEV_DIR/.credentials.json"
    fi

    [[ -f "$DEV_DIR/.claude.json" ]] || cp "$HOME/.claude.json" "$DEV_DIR/.claude.json" 2>/dev/null || true
fi

cd "${CONFIGURED_REPO:-$COMMAND_CENTER_RUNTIME_PROJECT_DIR}"
# Build isolation (ui9 A1): dev runs its own artifacts. dist/ and dist-server/
# belong to live and are written only by promote.sh.
if [[ "$SERVICE_INSTANCE" == "live" ]]; then
    export COMMAND_CENTER_FRONTEND_DIST="$PWD/dist"
    exec node dist-server/server/index.js
fi
export COMMAND_CENTER_FRONTEND_DIST="$PWD/dist-dev"
exec node dist-server-dev/server/index.js
