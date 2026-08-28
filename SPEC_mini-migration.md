# SPEC_mini-migration.md — Mac mini as the single always-on Claude machine

Draft 3 (Forge v78). Build-facing spec: everything Claude Code needs to know to build this. Sources: Command Center capability recon (2026-08-18), ui3 P4 portability report, locked decisions. Companion file WORKFLOW_mini.md is Willem-facing and not build input.

## 1. Goal

One always-on Mac mini (M4, 16GB, Tahoe 26.2) hosts Command Center as the sole interface to Claude Code. All other machines and the phone are browsers pointed at it over Tailscale. A per-project planner session plans and dispatches; workers execute on the mini via headless chains; Willem can also work a worker directly without the planner; a watchdog inside the server monitors at zero token cost; notifications go to every subscribed device and are exactly two kinds: decision-needed and verified-done.

## 2. Architecture

All components on the mini:

- **Command Center live** — port 4747, launchd service, HOST=0.0.0.0 behind Tailscale Serve (tailnet HTTPS). The only interface.
- **Command Center dev** — port 4748, on-demand, own DATABASE_PATH and own Claude config dir (B5).
- **Planner sessions** — one long-lived Command Center session per project, booted by /planner, governed by PLANNER.md + planner/reference/. Only the planner writes STATE.md/PROJECT.md.
- **Worker runs, two origins.** Dispatched: headless chains (B4), fresh session per phase, tagged origin=dispatch. Direct: interactive sessions Willem drives himself in the worker pane, booted by /worker, tagged origin=direct, any model/effort he picks. Existing runner doctrine (commit gate, journal, foreground gate, walk-away tail) carries over intact for dispatched work.
- **Watchdog + scheduler** — one module inside the Command Center server (it owns the DB, run registry, and web-push already). No separate daemon.
- **Browser layer** — per-project Chrome profiles + agent-browser (7).
- **cswap** — already installed; runs as its own daemon. Build-time verify: SDK-spawned sessions pick up swapped credentials the same way terminal sessions do.
- **ccsync** — already includes the mini.
- Repos under the mini's projects folder (verify exact path and casing at build time; this is macOS: zsh/bash scripts, launchd not Task Scheduler, pmset not powercfg, forward-slash paths, no PowerShell anywhere).

## 3. Phase A — Host it (ops)

- A1. Scrub the mini to a pure state for this role. Remove Orca completely: the app, its login items, launch agents/daemons, support files, caches, and any lingering processes. Audit everything else that runs at boot or in the background from the earlier spoton-worker era and remove what this system does not need, keeping only Tailscale, ccsync, cswap, Parsec, and macOS essentials. Confirm Bitwarden zero-touch and ccsync are live, baseline the server test suite on this machine (KEG has 5 known env-dependent failures; establish the mini's own baseline before any fork work).
- A2. Clone command-center, fresh npm install (per-platform binaries; never copy node_modules across machines), build. Pin/record the Node version.
- A3. launchd service for live: RunAtLoad, KeepAlive, logs to ~/forge-logs/command-center-service/.
- A4. Tailscale Serve: tailnet HTTPS at the mini's MagicDNS name → 4747, plus a second route (distinct HTTPS port) → 4748 so dev is reachable from any device. HTTPS is required for the service worker and push; localhost testing does not prove the phone path.
- A5. Auth on; tailnet-only, never Funnel. Auth sessions long-lived (90 days): Tailscale is the perimeter, the login must not re-prompt constantly on any device.
- A6. Device bring-up as a hard acceptance gate. Phone: Tailscale VPN On Demand (Always for Wi-Fi and Cellular), Command Center added to home screen, push permission granted via in-app user-tap prompt, test notification on the lock screen, tap opens the right session. Desktops: browser push permission granted on KEG and SILO, test notification lands as a native OS notification.
- A7. Repos cloned: the named projects + command-center + scratch.
- A8. Power: never sleep (pmset), restart after power failure, caffeinate if needed for long headless chains.
- A9. Backup: nightly launchd job tarballing ~/.claude (transcripts) and ~/.command-center (DB, assets, push subscriptions) to an off-mini destination (another fleet machine over Tailscale or an attached drive). The mini becoming the single home of all session history is otherwise a single point of total loss; git does not cover transcripts.

## 4. Phase B — Fork work

- B1. **Conversations restructure (claude.ai model).** App-owned `assigned_project_path` column that the filesystem synchronizer never touches; lists and feeds prefer it over the cwd-derived value. Global Conversations tab (the cross-project feed exists) + Projects tab. Attach-to-project action on any chat. Standalone chats are sessions running in a hidden `scratch` repo, displayed as project-less. Scratch is exempt from push doctrine: local-only git, no remote; prompts dispatched into scratch end at commit, never push.
- B2. **Worker pane, interactive.** Each project shows one persistent Worker tab pinned beside its chats; optional side-by-side split on desktop; on mobile a tab in the project's tab row. It auto-follows the most recent worker session (dispatched or direct). It is a full interactive chat surface, not a viewer: Willem can type into an idle worker session or start a new one with any model and effort from the standard composer controls. New Session inside the pane auto-sends /worker (B10), mirroring how New Session elsewhere boots /planner. The pane surfaces files the run produced (cheap version: link into the existing file tree filtered to paths touched since the run's base commit).
- B3. **Watchdog module.** Listens to the run registry and event stream for dispatched runs and chains. Events → actions:
  - Chain end (or single dispatched run end): wake the project's planner with a one-line check prompt (final summary tail + instruction to verify against git log and the punch list).
  - Chain stopped on commit gate: same wake, flagged as stopped.
  - Stuck: a running dispatched session with no event emission for 30 minutes → wake the planner to assess (check process liveness and journal before declaring it dead; long builds emit nothing mid-tool-call, so assess, never kill blind).
  - permission_request / interactive_prompt on a dispatched run: decision-needed notification directly.
  - Direct (origin=direct) sessions are Willem's own: the watchdog never wakes the planner for them and never notifies on them.
  - Wakes are queued and retried: if the planner session is mid-turn (RUN_IN_PROGRESS), hold the wake and retry until idle; serialize multiple pending wakes.
  - Weekly self-test notification so silent push death is caught.
  - Same poll checks free disk space and memory pressure; threshold breach is a decision-needed notification.
- B4. **Dispatch primitive: a chain runner script + thin CLI on the mini.** Port of the PowerShell runner loop to bash/zsh: takes a slug and an ordered list of phase prompt files, runs each as a fresh headless session via the server's run surface, enforces the commit gate between phases, journals to ~/forge-logs/<slug>/, registers the chain with the watchdog. The planner invokes it once per punch list (`dispatch <project> <slug>`) and goes idle; it never polls, never dispatches per-phase, never reads worker transcripts. The dispatch CLI resolves the server API key itself from server config; the key never appears in a prompt, a transcript, or planner output. Phase prompts are files the planner writes to the repo (compiled per existing runner doctrine: self-contained, walk-away tail, journal clause, foreground gate; sync clause on phase 1 only). New `planner/reference/dispatch.md` documents this lane; PLANNER.md gains the one-line load rule.
- B5. **Dev/live isolation.** Patch the fork to honor a configurable Claude config dir (watcher and synchronizer hardcode os.homedir() today); dev runs with its own config dir, own DATABASE_PATH, port 4748. Fix local-server.json last-writer-wins (per-instance marker file). Acceptance: dev sessions never appear in live's lists and vice versa, proven both directions.
- B6. **Promote/drain/auto-rollback.** Promote flow: build on dev → verify → query live's running sessions → if dispatched turns are in flight, wait for the commit gate or ask (in-flight turns die on restart; drain-before-restart is the v1 mitigation, run persistence is deferred) → restart via launchd. Boot wrapper: health check with timeout; on failure, revert to last good tag, rebuild, restart, decision-needed notification. The last-good tag advances only after a healthy post-promote check. Idle sessions (planner included) survive restarts by design since session state is the on-disk transcript; only in-flight turns are at risk, which drain covers.
- B7. **Planner auto-rotation, user-controlled.** The server knows each session's honest context usage (the ring math work). At a threshold on a planner session, the watchdog wakes it with the standing instruction to run /handoff and confirms a fresh planner boots from STATE.md. Settings UI: an on/off toggle and an editable threshold percentage (default 60), applied against the session model's real window. No planner session degrades into its ceiling mid-autonomy.
- B8. **Notifications everywhere, two kinds only.** Every subscribed endpoint gets every notification: phone PWA plus desktop browsers on KEG/SILO (web push renders as native OS notifications on Windows). No per-device routing in v1; broadcast is the design. Foreground enhancement: a Command Center tab that is open and visible when an event lands also plays the Orca notification sound (extract the audio asset from the upstream stablyai/orca repo, self-host it in command-center public/) alongside the notification. Constraint to respect, not fight: background web push cannot carry custom sounds on Windows or iOS, so the sound is a foreground-tab behavior only; background pushes use system default. Files-polish rider: Content-Disposition + nosniff on the inline files/content route.
- B9. **Monday self-maintenance, two targets.** The scheduler (same module as the watchdog) fires weekly, dispatching a maintenance run into the COMMAND_CENTER project:
  - Upstream Command Center: fetch upstream, classify deltas (backend-safe / frontend-touching / skip), auto-apply backend-safe ones through the normal dispatch → dev-verify → promote loop, decision-needed notification only for frontend-touching changes.
  - Claude Code CLI: compare installed `claude --version` against latest, read the release notes for the gap, assess impact on the fork (SDK behavior, flags the launchers pin, classifier or model changes) and on planner/worker doctrine (PLANNER.md, reference files, dispatch.md). Safe updates and doctrine touch-ups apply silently with commits; anything judgment-shaped (a breaking change, a new feature worth adopting, a doctrine rewrite) is a decision-needed notification, not a silent edit.
  - Nothing to do = total silence.
- B10. **/worker command + worker doctrine (global via ccsync, planner never loads it).** A slash command mirroring /planner that boots a direct worker session with short standing rules: read before editing; commit at natural boundaries with descriptive one-line messages (commits are the ledger the planner reconciles from); push per normal doctrine except in scratch; never write STATE.md or PROJECT.md (planner-owned); keep final summaries short. Kept deliberately tiny so direct sessions stay cheap.

## 5. Orchestration protocol (context discipline)

- Planner context is spent on planning and verification only. Monitoring costs zero planner tokens; the watchdog owns it.
- Worker output enters the planner only as: final summary tail, git log, journal lines on failure, punch-list checkbox state. Raw transcripts never.
- **Git is the reconciliation ledger.** STATE.md carries a last-reconciled commit hash. On every wake and every handoff, the planner runs `git log <anchor>..HEAD --oneline` first, absorbs the one-liners (this is how Willem's direct-worker commits become known without costing anything beyond their subject lines), notes anything that interacts with current work, updates the anchor. Deep-reading a commit's diff happens only when the one-liner makes it clearly relevant. This replaces any notion of workers writing to STATE.md: descriptive commit messages are the log, the anchor diff is the catch-up, and STATE.md stays single-writer.
- Escalation ladder unchanged: planner answers from locked decisions or prompt scope; everything else is a decision-needed notification. Verified-done fires only after the planner's check passes, via a notify endpoint.
- STATE.md hard cap, PROJECT.md prune rule, /handoff semantics: unchanged.
- Interruption recovery unchanged: commits + checked-off lists make any death resumable; resuming a stopped chain is a fresh planner compile at resume time.

## 6. Self-surgery (Command Center working on itself)

- All Command Center iteration flows through the COMMAND_CENTER project's planner like any other project; the one special rule is dev-first. Small iterations may also go direct-to-worker in the COMMAND_CENTER project, same dev-first rule.
- Loop: dispatch → worker builds and verifies on 4748 → decision-needed notification (all devices; eyeball from whichever screen Willem is at) → approve in chat → worker promotes per B6 → live clients drop and auto-reconnect (3s retry + event replay exist today).
- Frontend changes always gate on Willem's eyeball. Backend-safe changes may promote without one when pre-approved in the dispatch.
- Worst case (live down, rollback failed): the planner process is independent of the web layer; fallback access is SSH over Tailscale, or Parsec / Chrome Remote Desktop to the mini's screen.
- During the initial migration build, live restarts freely: Command Center is not yet the sole interface. Cutover (KEG demoted to browser) happens only after section 10's acceptance run, and dev-first discipline starts at cutover.

## 7. Browser subsystem

- agent-browser stays the default driver per existing doctrine: real Chrome binary, persistent profiles, Claude owns every launch.
- Concurrency: the agent-browser daemon is a machine-wide singleton with close-all-first startup, which collides when 2+ projects automate at once. Generalize the existing CDP recipe: each project gets a dedicated real-Chrome instance on its own fixed debug port with a persistent user-data-dir under ~/browser-profiles/<project>/, attached over CDP. Build-time verify whether current agent-browser can attach to multiple CDP targets concurrently; if not, concurrent phases drive Playwright over CDP and single-automation runs keep the plain daemon.
- Seed profile at ~/browser-profiles/_seed/ holds the real logins (QuickBooks, Google, AccuLynx, Enzy). Project profiles clone from it on first need, only while the seed browser is closed. On a login failure in a project profile, re-clone from seed before falling back to the login protocol.
- Login protocol: logins.json migrates from C:\agent-auth\ to the mini (~/agent-auth/logins.json, same schema, populated from Bitwarden). Login walls fill from the file; OTP walls raise a decision-needed notification and the code arrives in chat; persistent profiles make both rare.
- Resource cap: concurrent Chrome instances capped at 3 until real memory behavior on 16GB is observed; the chain runner queues browser-phase chains beyond the cap rather than launching a fourth.
- Mobile verification on real Mobile Safari (simulators on the mini) becomes available post-migration, per the browser module's stated intent.

## 8. Credentials and secrets

- Rewrite the AccuLynx and Enzy skills in this build: secrets resolved at runtime via the credential-provisioning chain, referenced by env-var name in commands, never printed, never baked into the skill file. Verify the rewritten skills work on the mini before ccsync propagates them.
- Standing rule added to PLANNER.md, dispatch.md, and /worker: no secret ever appears in a skill file, a compiled prompt, a chat message, or a committed file; credential-provisioning is the only path. OTP codes are the sanctioned exception.
- The dispatch CLI is part of this rule: the server API key lives in server config, read by the CLI, never echoed.
- Out of scope: rotating the AccuLynx key (Willem), historical transcript cleanup (Willem).

## 9. Phase C — Context repopulation and planner fleet boot

- C1. Willem places the fresh account export in the mini's Downloads. The remine runs against the prior mined seeds in the spoton-worker repo, superseding them where the fresh export is richer.
- C2. Per-project distills regenerate PROJECT.md seeds for every planner project, scoped as before to: preferences, hard nos, things tried, current state, open items. The prior allowlist exclusions (Personal, Legal, Nomad, Health) remain excluded.
- C3. Boot a planner in every project: /planner, PROJECT.md seed absorbed, STATE.md initialized with a current reconciliation anchor, one round-trip dispatch smoke test per project.
- C4. End state: every project fully lit, zero manual context work left for Willem.

## 10. Failure-mode inventory

| Failure | Detection | Response |
|---|---|---|
| Web server down | launchd; planner process unaffected | Auto-restart; boot-fail → rollback + notification |
| Bad promote | Boot health check fails | Auto-rollback to last good tag + notification; dev stays up for diagnosis |
| In-flight turn killed by restart | Commit gate: no commit | Drain-before-promote prevents; else resume per interruption recovery |
| Worker hung | Watchdog 30-min silence | Planner assesses (process + journal) before any kill; re-dispatch or notification |
| Planner mid-turn when wake arrives | RUN_IN_PROGRESS | Watchdog queues and retries the wake |
| Planner context near ceiling | B7 threshold (user-set) | Auto /handoff + fresh boot from STATE.md |
| Planner session dead | Wake gets no response | Watchdog boots a fresh planner; statelessness is the design |
| Mini reboot / power loss | launchd RunAtLoad + pmset autorestart | Services return; interrupted phases resume via commits |
| Tailscale down | URL unreachable from devices | Mini keeps working; runs finish; notifications delayed; LAN fallback at home |
| Push silently broken (iOS flakiness) | Weekly self-test | Re-subscribe flow; worst case the app shows true state on open |
| Disk full / memory pressure | Watchdog poll thresholds | Decision-needed notification; Chrome cap limits the worst offender |
| SQLite corruption | Server boot errors | DB is metadata; transcripts are truth; rebuild by rescan |
| cswap accounts exhausted | Runs fail on quota | Commit gate stops chains; decision-needed notification |
| Total mini loss | — | A9 nightly backup restores transcripts + DB; repos and state files re-clone from git |

## 11. Build order, pilot, cutover

Phase A (A1-A9) → B5 (isolation first, so dev exists before fork surgery) → B1 → B2 → B3+B4 (watchdog + dispatch, the core loop) → B6+B7 → B8 → B9+B10 → 7 (browser subsystem) → 8 (skill rewrites) → Phase C (remine + fleet boot). Each phase leaves live Command Center working.

Acceptance run before cutover, on ProxyFeed: hand its planner a real multi-phase task by voice from the phone and observe the full loop end to end: compile → dispatch → chain runs → watchdog wake → planner verify → verified-done notification on phone and desktop simultaneously → files viewable from the phone. Separately prove: a direct-to-worker session with a manual commit that the planner correctly absorbs on its next wake, an OTP login round-trip, a dev-verify-promote cycle on Command Center itself, and a forced bad promote rolling back.

After acceptance: demote KEG/SILO to browsers. Orca retirement and machine teardown remain deferred until the system has run real work for a stretch; SILO/KEG local installs stay untouched as the rollback path until then.

## 12. Deferred / out of scope

- Run persistence across restarts (drain covers v1).
- Per-device notification routing (broadcast is v1).
- Mobile-first UI polish (usable today; perfecting it is post-migration iteration).
- Worker reading OTPs from the admin inbox (kills the relay; adds email scope; Willem's call later).
- KEG/SILO teardown + Orca retirement (post-acceptance, post-stretch).
- Historical credential-leak cleanup (Willem, separately).
