# MIGRATION.md — mini-migration run log

Machine: Mac mini M4 16GB, macOS 26.2 (25C56). Projects root: `/Users/spoton-worker/Projects` (capital P; filesystem case-insensitive). Node v24.13.0, npm 11.6.2, Claude Code updated 2.1.220 → 2.1.235.

## Phase 0 audit record (2026-08-18)

Removed:
- Orca completely: app (/Applications/Orca.app v1.4.182), running daemon + 3 orca-tcc-login shells + their stale MCP children, ~/.orca, ~/Library/Application Support/orca, com.stablyai.orca.plist pref, /usr/local/bin/orca CLI shim, installer dmg in Downloads. No Orca LaunchAgents existed. Verified zero orca-named files remain.
- Era LaunchAgents unloaded, plists archived to ~/forge-logs/mini-migration/removed-launchagents/ (repos/data untouched): com.spotonroof.indeed-porter, com.spotonroof.indeed-porter-watchdog (porter was in CHALLENGED safe mode since 2026-07-28), com.spoton.forge-worker (forge-propagator worker), com.spoton.leap-gateway, com.spoton.leap-monitor, com.spoton.leap-tunnel (hermes + cloudflared), com.spoton.proxyfeed-ai (Codex-drain daemon).

Kept:
- Spec keep-list: Tailscale, ccsync (daemon live, repo synced), cswap, Parsec.
- com.spoton.bw-session-refresh: required by this spec's own Bitwarden zero-touch requirement; verified `bw status` = unlocked non-interactively via ~/.local/state/bitwarden/session.env.
- LuLu (firewall) + Mos login items, Google keystone/updater (Chrome is required by spec §7), Docker daemons (on-demand, no boot activity; full Docker removal left for Willem's call).

Repos: all planner-mapped repos pulled (the brief's "five named project repos" is not enumerated anywhere on this machine; treated as the planner-roster superset: proxyfeed, spoton-worker, spoton-payroll, spoton-stats, spoton-core, spoton-book, SignTool, snapbridge-photos, acculynx-gateway, ghl, noggin, command-center — all present and current). spoton-core had 30 uncommitted staged changes blocking its pull; preserved verbatim on local branch `wip/pre-mini-migration-20260818`, main then fast-forwarded to 166e9bfd. Local-only scratch repo created at ~/Projects/scratch (git init, zero remotes). pmset: sleep 0, disksleep 0, autorestart 1, womp 1.

Test baseline (this machine): `npm test` server suite — **270 pass / 0 fail** (KEG's 5 env-dependent failures do not reproduce here). Full `npm run build` clean after fresh `npm install` (node_modules rebuilt from scratch).

## Phase log

- Phase 0 — environment and audit: complete. Orca removed, era agents archived, Bitwarden zero-touch + ccsync verified, repos updated, scratch created, fresh install + clean build, baseline 270/0, pmset set. Commit: 5e1305b
