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
    launchctl bootstrap "gui/$UID_NUM" "$target"
    echo "installed + bootstrapped $label"
}

chmod +x "$SCRIPT_DIR/cloudcli-backup.sh"
install_agent com.spoton.cloudcli-live.plist.template com.spoton.cloudcli-live
install_agent com.spoton.cloudcli-backup.plist.template com.spoton.cloudcli-backup

launchctl list | grep -E 'com\.spoton\.cloudcli' || true
