#!/bin/zsh
# Idempotent installer for the mini's Command Center system services (spec A3/A9).
# Materializes the plist templates with this machine's real paths into
# ~/Library/LaunchAgents and (re)bootstraps them. Safe to re-run after any
# template change; running services are restarted by the bootout/bootstrap pair.
set -eu

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h:h}"
NODE=$(command -v node || echo /usr/local/bin/node)
eval "$("$NODE" "$REPO/shared/runtime-anchors.js" --shell)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
UID_NUM=$(id -u)

mkdir -p "$AGENTS_DIR" \
    "$HOME/forge-logs/$COMMAND_CENTER_RUNTIME_SERVICE_LOG_DIR_NAME" \
    "$HOME/forge-logs/$COMMAND_CENTER_RUNTIME_BACKUP_LOG_DIR_NAME" \
    "$HOME/forge-logs/$COMMAND_CENTER_RUNTIME_SCRUB_LOG_DIR_NAME" \
    "$HOME/backups/$COMMAND_CENTER_RUNTIME_NIGHTLY_BACKUP_DIR_NAME"

install_agent() {
    local template="$1" label="$2"
    local target="$AGENTS_DIR/$label.plist"
    sed -e "s|__HOME__|$HOME|g" -e "s|__REPO__|$REPO|g" -e "s|__NODE__|$NODE|g" \
        -e "s|__LAUNCHD_PREFIX__|$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX|g" \
        -e "s|__LEGACY_STEM__|$COMMAND_CENTER_RUNTIME_LEGACY_STEM|g" \
        -e "s|__DEV_DATA_DIR__|$COMMAND_CENTER_RUNTIME_DEV_DATA_DIR|g" \
        -e "s|__SERVICE_LOG_DIR__|$COMMAND_CENTER_RUNTIME_SERVICE_LOG_DIR_NAME|g" \
        -e "s|__BACKUP_LOG_DIR__|$COMMAND_CENTER_RUNTIME_BACKUP_LOG_DIR_NAME|g" \
        -e "s|__SCRUB_LOG_DIR__|$COMMAND_CENTER_RUNTIME_SCRUB_LOG_DIR_NAME|g" \
        "$SCRIPT_DIR/$template" > "$target"
    launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
    sleep 1
    launchctl bootstrap "gui/$UID_NUM" "$target"
    echo "installed + bootstrapped $label"
}

chmod +x "$SCRIPT_DIR/$COMMAND_CENTER_RUNTIME_LEGACY_STEM-backup.sh" "$SCRIPT_DIR/transcript-scrub.mjs" "$SCRIPT_DIR/dispatch" "$SCRIPT_DIR/dispatch-chain-runner" "$SCRIPT_DIR/$COMMAND_CENTER_RUNTIME_LEGACY_STEM-dev-start.sh"
mkdir -p "$HOME/.local/bin"
ln -sf "$SCRIPT_DIR/dispatch" "$HOME/.local/bin/dispatch"
# The tool guard (codex job 2) is one script for both engines: Codex's hook
# calls it in place; Claude's PreToolUse hook reads the synced copy under
# ~/.claude/hooks (the user settings.json must keep a ~/.claude path so the
# hook survives ccsync's canonicalization on every machine).
cp "$SCRIPT_DIR/tool-guard.cjs" "$HOME/.claude/hooks/git-guard.js"
chmod +x "$SCRIPT_DIR/promote.sh"
ln -sf "$SCRIPT_DIR/promote.sh" "$HOME/.local/bin/promote"
mkdir -p "$COMMAND_CENTER_RUNTIME_DEV_DATA_DIR" "$HOME/.claude-dev/projects"
# Dev's Claude Code CLI shares onboarding state but nothing else with the live tree.
[[ -f "$HOME/.claude-dev/.claude.json" ]] || cp "$HOME/.claude.json" "$HOME/.claude-dev/.claude.json" 2>/dev/null || true
install_agent "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-live.plist.template" "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-live"
install_agent "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-backup.plist.template" "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-backup"
install_agent "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-scrub.plist.template" "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-scrub"
install_agent "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-dev.plist.template" "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX-dev"

launchctl list | grep -F "$COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX" || true
