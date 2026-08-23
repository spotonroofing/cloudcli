#!/bin/zsh
# Dev-instance launcher: refresh the isolated CLAUDE_CONFIG_DIR's credentials
# from the Keychain (where the CLI and cswap keep them), then exec the server.
# The dev config dir needs its own .credentials.json because a non-default
# CLAUDE_CONFIG_DIR does not see the default Keychain login.
set -u

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

cd "${CLOUDCLI_REPO:?CLOUDCLI_REPO must point at the repo root}"
# Build isolation (ui9 A1): dev runs its own artifacts. dist/ and dist-server/
# belong to live and are written only by promote.sh.
export CLOUDCLI_FRONTEND_DIST="$PWD/dist-dev"
exec node dist-server-dev/server/index.js
