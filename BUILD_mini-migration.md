# BUILD_mini-migration.md

Goal: turn this Mac mini into the single always-on Claude machine per SPEC_mini-migration.md in this repo root. The spec is the authoritative requirements document: read it fully before phase 0 and treat every numbered spec item as binding. This brief is the execution plan; where it and the spec differ in detail, the spec wins. The why: consolidate a three-machine workflow into one host so planning, dispatch, and monitoring happen in one place with tokens spent only on planning and building.

Stack and locked decisions: Command Center fork (this repo) on ports 4747 live and 4748 dev; Express + WebSocket + SQLite + @anthropic-ai/claude-agent-sdk; launchd for services; Tailscale Serve for tailnet HTTPS; watchdog and scheduler as server modules; bash/zsh for all scripts (this is macOS: no PowerShell, pmset not powercfg, launchd not Task Scheduler); spoton-worker repo at the same projects root holds planner doctrine and mined seeds; ~/.claude is ccsync-managed.

Final acceptance: the system self-test in phase 12 passes end to end and WILLEM_CHECKLIST.md exists, covering everything only Willem can do.

Whole-file rules:
- Ensure .gitignore excludes .env before any git add, in every repo touched.
- Each phase leaves the live app working and ends with a commit in the repo it touched; push at each phase boundary (this build restarts live freely: cutover has not happened, nothing depends on uptime yet).
- Secrets follow the credential-provisioning skill; no secret appears in any committed file, script, or summary. logins.json and browser profiles are never committed.
- The scratch repo is local-only: no remote, commits only, no push.
- ccsync owns ~/.claude sync; write files into ~/.claude normally and let the daemon propagate; do not touch ccsync internals (_ops, _conflicts, heartbeat).
- System artifacts (launchd plists, shell scripts, the dispatch CLI, backup job) live versioned in this repo under scripts/macos/ with an idempotent install script; installing copies or symlinks them into place.
- Substantial phases (2, 3, 4, 5, 6, 7, 8, 11) end with a fresh-context subagent verifying the result against the matching spec section before the commit; keep working while subagents run, and intervene if one goes off track or is missing relevant context.
- Where subtasks inside a phase are independent, delegate the mechanical ones to subagents running Sonnet 5 at medium effort, each with complete instructions and its own done check; anything needing interpretation comes back rather than being guessed at. Keep this under 4 subagents at a time.
- Progress honesty: before reporting a phase done, check each claim against an actual tool result from this session.
- Keep a MIGRATION.md log in this repo root: one line per phase with outcome and commit hash, appended at each boundary.
- If a phase cannot be completed, stop and state exactly what is blocking rather than looping or moving on; completed phases stay committed.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

Read before editing, every phase: open the files a change touches before changing them; never speculate about code you have not opened. Only change what the spec directly requires; do the simplest thing that works well; no features, abstractions, fallbacks, or validation beyond it; trust internal code and validate only at system boundaries; a general solution, never hard-coded to pass a check; if a done check is wrong or infeasible, stop and say so.

## Phase 0 — Environment and audit (spec A1, A2, A7, A8)

Goal: a clean, known-good base. Run claude update and record the version. Remove Orca from this machine completely: quit any running instance, delete the app, and sweep its login items, LaunchAgents and LaunchDaemons, Application Support, preferences, and caches so nothing Orca-related remains or starts at boot. Then audit everything else running at boot or in the background from the earlier spoton-worker era and remove what this system does not need; keep only Tailscale, ccsync, cswap, Parsec, and macOS essentials, and record in MIGRATION.md what was removed. Confirm Bitwarden CLI is zero-touch (vault unlocked non-interactively) and ccsync is current. Establish the projects root (verify the actual path and casing on this machine and use it consistently everywhere). Clone or update: the five named project repos, proxyfeed, spoton-worker; create the local-only scratch repo. Fresh npm install and full build of this repo; record the Node version; run the server test suite and record this machine's baseline in MIGRATION.md (KEG has 5 known env-dependent failures; this machine gets its own honest baseline). pmset: never sleep, autorestart after power failure.
Done when: build clean, baseline recorded, all repos present, MIGRATION.md line committed.

## Phase 1 — Live service, tailnet HTTPS, backup (spec A3, A4, A5, A9)

Goal: Command Center live as a boot-persistent service reachable from the tailnet over HTTPS. launchd service for live (RunAtLoad, KeepAlive, logs to ~/forge-logs/command-center-service/). Tailscale Serve: primary HTTPS route to 4747 and a second HTTPS port to 4748. If tailnet HTTPS certs are not enabled on the tailnet, this is the one genuine pause in this build: state exactly which admin-console toggle Willem must flip, wait for his go-ahead, then continue. Auth session lifetime to 90 days (config or code as the codebase dictates). Nightly backup launchd job: tarball ~/.claude and ~/.command-center to the off-mini destination reachable over Tailscale; pick the healthiest available fleet target, document the choice in MIGRATION.md, verify one real backup ran.
Done when: curl over the tailnet HTTPS URL returns healthy from this machine, launchctl kickstart restarts it clean, one backup archive exists at the destination.

## Phase 2 — Dev/live isolation (spec B5)

Goal: a dev instance that cannot contaminate live. Patch the fork so the Claude config directory is configurable (watcher and synchronizer currently hardcode os.homedir()); dev runs with its own config dir, own DATABASE_PATH, port 4748; fix local-server.json to a per-instance marker. Stand dev up under its own launchd service (on-demand, not RunAtLoad).
Done when: a session created on dev never appears in live's lists and vice versa, proven in both directions against the running instances.

## Phase 3 — Conversations restructure (spec B1)

Goal: the claude.ai model. assigned_project_path column owned by the app and never touched by the synchronizer; lists and feeds prefer it; global Conversations tab alongside Projects; attach-to-project action on any chat; standalone chats run in the scratch repo and display as project-less. Desktop and mobile both.
Done when: in the live browser, a standalone chat is created from Conversations, then attached to a project, appears in both views correctly, and survives a full filesystem rescan without the association reverting.

## Phase 4 — Interactive worker pane and /worker (spec B2, B10)

Goal: the always-there worker surface. Per-project Worker tab pinned beside chats, auto-following the most recent worker session by origin tag; side-by-side split on desktop; a tab in the project tab row on mobile; fully interactive with the standard composer, model, and effort controls; New Session in the pane auto-sends /worker; the pane links to files touched since the run's base commit. Write the /worker command into ~/.claude/commands: the short standing rules from spec B10, kept deliberately tiny.
Done when: in the live browser, a direct worker session is started from the pane with a non-default model, does a trivial file change, commits with a descriptive message; the pane followed it and the files link resolves.

## Phase 5 — Watchdog, scheduler, notifications everywhere (spec B3, B8)

Goal: monitoring at zero token cost and two notification kinds broadcast to every subscribed endpoint. Watchdog module per spec B3 exactly: chain-end and stopped wakes with summary tail, 30-minute stuck assessment (assess, never kill blind), permission and interactive-prompt events straight to decision-needed, origin=direct sessions ignored entirely, queued and retried wakes serialized when the planner is mid-turn, weekly self-test notification, disk and memory thresholds. Notifications per B8: broadcast to all push subscriptions; a visible foreground tab additionally plays the Orca notification sound (extract the audio asset from the upstream stablyai/orca repo, self-host in public/); background pushes keep the system default sound and no phase fights that constraint. Add the files/content hardening headers.
Done when: a simulated dispatched-run completion produces a queued planner wake observable in logs, a test notification reaches every stored subscription endpoint (delivery to real devices is Willem's checklist item), and the foreground sound plays in the live browser.

## Phase 6 — Dispatch primitive (spec B4)

Goal: the fire-once chain runner. Bash chain runner + thin dispatch CLI in scripts/macos/, installed on PATH: slug plus ordered phase prompt files, fresh headless session per phase through the server's run surface, commit gate between phases, journal to ~/forge-logs/<slug>/, chain registered with the watchdog, Chrome-cap queueing hook (phase 9 fills it in). The CLI reads the server API key from server config itself; the key never appears in prompts, transcripts, or output. Write planner/reference/dispatch.md in the spoton-worker repo documenting the lane per spec B4 and section 5 (including the git-ledger reconciliation rule and the reconciliation anchor in STATE.md), add the one-line load rule to PLANNER.md, commit and push spoton-worker separately from this repo.
Done when: a two-phase toy chain in the scratch repo runs to completion with one dispatch invocation, both commits land, the journal shows both phase boundaries, and a deliberately failing third phase stops the chain at the commit gate.

## Phase 7 — Promote, drain, rollback, rotation (spec B6, B7)

Goal: safe self-surgery and planner longevity. Promote script per B6: build on dev, verify, drain live's in-flight dispatched turns, restart via launchd; boot wrapper with health check and auto-rollback to the last-good tag plus decision-needed notification; the tag advances only after a healthy post-promote check. Planner auto-rotation per B7: watchdog-driven /handoff at the threshold, settings UI with an on/off toggle and an editable percentage (default 60) against the model's real window.
Done when: a real promote of a trivial change succeeds through the full flow, and a forced-bad promote (deliberately broken build) rolls back automatically to a healthy live and fires the notification.

## Phase 8 — Monday self-maintenance (spec B9)

Goal: the weekly silent maintainer. Scheduler entry dispatching the maintenance run into this project: upstream Command Center delta classification and backend-safe auto-apply through the dispatch flow, plus the Claude Code CLI version and release-notes assessment against the fork and the doctrine files, silent when safe, decision-needed when judgment-shaped, silence when there is nothing.
Done when: a manual trigger of the scheduler entry runs the full check against current state and journals a correct classification (whatever it finds, including nothing).

## Phase 9 — Browser subsystem (spec 7)

Goal: concurrent, isolated, logged-in browser automation. Install agent-browser; per-project dedicated real-Chrome with fixed debug ports and persistent user-data-dirs under ~/browser-profiles/<project>/; seed profile scaffold at _seed (no logins yet; Willem logs in later per checklist); clone-from-seed on first need only while seed is closed, re-clone on login failure; verify whether agent-browser drives multiple CDP targets concurrently and record the honest answer in MIGRATION.md, wiring Playwright-over-CDP as the concurrent path if it cannot; migrate logins.json to ~/agent-auth/logins.json populated from Bitwarden (file on disk only); implement the 3-Chrome cap with chain-runner queueing.
Done when: two simultaneous toy automations in two different project profiles run without touching each other's state, and the cap demonstrably queues a fourth.

## Phase 10 — Skill rewrites and the no-secrets rule (spec 8)

Goal: close the credential faucet. Rewrite the acculynx-api and enzy-api skills in ~/.claude/skills to resolve their secrets at runtime via the credential-provisioning chain, referenced by env-var name and never printed; verify each with one real read-only API call on this machine. Add the standing no-secrets rule to PLANNER.md, dispatch.md, and the /worker command.
Done when: both skills succeed with zero secret material present in the skill files, the session transcript summary, or any commit; doctrine files updated, committed, pushed in spoton-worker.

## Phase 11 — Context repopulation and fleet boot (spec Phase C)

Goal: every project lit, zero manual context work left. Locate the fresh account export in ~/Downloads (if absent, this is input only Willem can provide: pause and ask). Remine against the prior seeds in spoton-worker, superseding where the export is richer; Personal, Legal, Nomad, and Health stay excluded. Regenerate PROJECT.md per project scoped to preferences, hard nos, things tried, current state, open items; commit each in its own repo. Boot a planner in every project through the live server, confirm each absorbed its seed and initialized STATE.md with a current reconciliation anchor, and run one trivial dispatch smoke test per project through the real chain runner.
Done when: every project has a committed PROJECT.md, a booted planner with a valid STATE.md anchor, and a passed smoke dispatch.

## Phase 12 — System self-test and Willem checklist

Goal: prove the loop and package the human gates. Run the automated end of the acceptance: a real multi-phase toy task in proxyfeed through planner compile, dispatch, chain, watchdog wake, planner verify, and a verified-done notification hitting the stored subscriptions; a direct-to-worker commit that the planner's next wake absorbs via the git ledger. Then write WILLEM_CHECKLIST.md in this repo root: phone bring-up (Tailscale On Demand, add to home screen, push grant, test notification), desktop push grants on KEG and SILO, seed-profile logins (QuickBooks, Google, AccuLynx, Enzy), the OTP round-trip test, the eyeball pass on a dev-verify-promote, and the cutover call. Final MIGRATION.md summary, commit, push.
Done when: the self-test loop completed with evidence for every step, and the checklist exists with nothing in it that this session could have done itself.
