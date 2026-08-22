#!/bin/zsh
# Idempotent installer for the mini's CloudCLI system services (spec A3/A9).
# Materializes the plist templates with this machine's real paths into
# ~/Library/LaunchAgents and (re)bootstraps them. Safe to re-run after any
# template change; running services are restarted by the bootout/bootstrap pair.
set -eu

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h:h}"
NODE=$(command -v node || echo /usr/local/bin/node)
AGENTS_DIR="$HOME/Library/LaunchAgents"
UID_NUM=$(id -u)

mkdir -p "$AGENTS_DIR" "$HOME/forge-logs/cloudcli-service" "$HOME/forge-logs/cloudcli-backup" "$HOME/backups/cloudcli-nightly"

install_agent() {
    local template="$1" label="$2"
    local target="$AGENTS_DIR/$label.plist"
    sed -e "s|__HOME__|$HOME|g" -e "s|__REPO__|$REPO|g" -e "s|__NODE__|$NODE|g" \
        "$SCRIPT_DIR/$template" > "$target"
    launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
    sleep 1
    launchctl bootstrap "gui/$UID_NUM" "$target"
    echo "installed + bootstrapped $label"
}

chmod +x "$SCRIPT_DIR/cloudcli-backup.sh" "$SCRIPT_DIR/dispatch" "$SCRIPT_DIR/dispatch-chain-runner" "$SCRIPT_DIR/cloudcli-dev-start.sh"
mkdir -p "$HOME/.local/bin"
ln -sf "$SCRIPT_DIR/dispatch" "$HOME/.local/bin/dispatch"
chmod +x "$SCRIPT_DIR/promote.sh"
ln -sf "$SCRIPT_DIR/promote.sh" "$HOME/.local/bin/promote"
mkdir -p "$HOME/.cloudcli-dev" "$HOME/.claude-dev/projects"
# Dev's Claude CLI shares onboarding state but nothing else with the live tree.
[[ -f "$HOME/.claude-dev/.claude.json" ]] || cp "$HOME/.claude.json" "$HOME/.claude-dev/.claude.json" 2>/dev/null || true
install_agent com.spoton.cloudcli-live.plist.template com.spoton.cloudcli-live
install_agent com.spoton.cloudcli-backup.plist.template com.spoton.cloudcli-backup
install_agent com.spoton.cloudcli-dev.plist.template com.spoton.cloudcli-dev

launchctl list | grep -E 'com\.spoton\.cloudcli' || true
