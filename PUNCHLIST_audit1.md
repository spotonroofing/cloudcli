# PUNCHLIST_audit1 — the 2026-09-04 two-model audit, acted on

## Goal

Two read-only audits (Codex GPT-5.6 Sol and Claude Opus 5, both 2026-09-04) went over the whole build and the workflow around it. This list lands every clear-cut finding: verify verdicts that tell the truth, runner budgets and defaults, the tool guard's false denials, promote and suite gates, notifications that mean what they say, jobs data past the first 100 rows, prompts that survive a dropped socket, chain controls and an error surface in the app, the phone touch pass, honest labels and times, and transcript performance. Product calls the audits raised are held for Willem separately and are not in this list. The full reports are at /Users/spoton-worker/Projects/spoton-worker/review-20260904/audit-codex-sol.md and audit-opus-5.md; each job may grep those two files for its finding's file:line evidence instead of rediscovering it.

## Stack and decisions already made

- Locked and unchanged: a commit-gate miss still stops a chain; a failed verify records and continues; anything acting on Willem's own sessions stays off by default; drawers and sheets, never centered popups; personal-tool copy only; ramped motion; 12-hour Eastern for every time Willem reads; no em dashes in UI copy.
- Verifier scope per doctrine: each job carries "Verify: yes" (fresh-context verifier) or "Verify: no" (UI-only, Willem's eye is the reviewer).
- Dev-first: build and verify on dev (port 4748, config dir ~/.claude-dev, DB ~/.cloudcli-dev/auth.db, public https://spoton-worker.tail6e1056.ts.net:8443). Never point a build at live's dirs and never restart live (4747); promote is the planner's job after the chain.

## Whole-file rules

- Read DESIGN.md (an index) before UI work and only the area files your job's files touch; reuse the closest existing element; update the matching area file when you change a documented pattern.
- Read only your job's section plus this block, the recent git log, and the files the job names. Read files with the Read tool in the ranges you need; never read a file over 20 KB whole (grep for the region first). Group related shell work into one call rather than many small ones, and do not narrate between tool calls.
- Codex jobs: no subagents; browser and UI checks use agent-browser against dev; the computer-use tool is not installed here, never attempt it. Claude (Opus 5) jobs: delegate to a subagent only for large tracks of work that are genuinely independent and parallelizable, give any subagent read-only tools, do not delegate what you can finish yourself in a handful of tool calls, and do not use subagents to verify your own work; deliver what was asked at the scope intended, make routine judgment calls yourself, and say so in a sentence if a better approach exists rather than quietly narrowing or widening; keep the final message brief.
- Ensure .gitignore excludes .env before any git add. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Check each item off in this file the moment it is verified, in its own small commit or at least its own file write, never all at once at job end: the jobs column reads this file live.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a 390 px phone viewport for anything phone-facing.
- Rebuild and restart dev only when the done check needs the running instance to show the change, and never twice when once serves. Server-only or test-verifiable work runs its tests without a rebuild.
- Lessons go to /Users/spoton-worker/Projects/spoton-worker/planner/cloudcli/lessons/ and the run summary section to /Users/spoton-worker/Projects/spoton-worker/planner/cloudcli/sessions/20260904-audit1-summary.md (the memory repo, not this one).
- On unrecoverable failure stop and state what blocks. You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0 — Verify verdicts tell the truth. Verify: yes

Goal: an INCONCLUSIVE verify is never stored or shown as passed, the verifier stops being sabotaged by the next unit's dev restart, and the commit gate proves the worker landed its own commit. Evidence: audit-codex-sol.md workflow findings 1 to 3 and audit-opus-5.md "The verify stage rarely produces a verdict" (19 of 45 verdicts inconclusive, all environmental; 12 phase-end journal records point at docs( commits). Files: scripts/macos/dispatch-chain-runner (verify stage near line 981, commit gate near 1210 to 1247, verify prompt near 889 to 900), server/modules/watchdog/watchdog.service.ts (verify-end handling near 1139), the watchdog routes and jobs data shape, tests under server/modules/watchdog/tests. Dependencies: none; runs first.

- [x] The runner sends the verdict itself (PASS, FAIL, INCONCLUSIVE) with verify-end; the server stores it as a first-class state on the unit (job_meta and whatever the jobs payload exposes), and a chain's terminal summary counts inconclusive separately from passed and failed. Nothing maps INCONCLUSIVE to passed anywhere; a test asserts the three states round-trip.
- [x] The verifier and the next unit's dev restart no longer collide: while a verify stage is in flight, the runner holds the next unit's dev rebuild and restart (the unit may start reading and editing, its restart waits) until the verify settles or a 20-minute verify cap passes, and journals the hold in one line. Cap expiry records INCONCLUSIVE with the reason "verify cap".
- [x] A mechanical pre-check runs before the verifier is spawned: the working tree is clean apart from ignored paths and the chain's own .dispatch and punch list files (untracked .dispatch files are never a failure), and the phase range BASE..HEAD contains at least one commit that is not a docs( commit. A pre-check miss records INCONCLUSIVE with the reason and skips the model verify entirely.
- [x] The commit gate binds the unit to its own work: the gate passes only when BASE..HEAD contains a non-docs( commit; a planner docs( commit alone no longer satisfies it, and the recorded unit commit is the newest non-docs( commit in range.
- [x] The verify prompt carries only what the verifier needs: the unit's identity, its punch-list section, its done check, the commit range and its diff stat, and the constraints (tree rules, dev mapping); it no longer embeds the builder's whole phase prompt.

Done check: server tests cover the three verdict states and the pre-check outcomes; a stub chain on dev with a fake INCONCLUSIVE verify shows the unit as inconclusive in the jobs payload and the chain total; a stub unit whose only new commit is a docs( commit trips the commit gate; the runner's verify-hold path is exercised once on dev with a stub verify that sleeps 30 seconds while the next unit starts. Commit.

## Job 1 — Runner budgets, defaults, dates. Verify: yes

Goal: a wedged unit cannot re-run itself forever, the runner's defaults name the right models, journal lines carry dates, paths carry the real date, and appended or orphaned work is never silent. Evidence: audit-opus-5.md spend finding 3 (no per-unit budget, LIMIT_STREAK resets), "The runner's Claude default is the wrong model", "Journal lines carry no date", "STATE.md's dates are wrong" (summary path stamped from a stale compile date), "An orphaned append is never reported", and audit-codex-sol.md workflow finding 8 (append bypasses manifest validation). Files: scripts/macos/dispatch-chain-runner, scripts/macos/dispatch, watchdog service and routes for the notice kinds, tests. Dependencies: Job 0 (same files; runs after it).

- [x] Per-unit budget: a unit that passes 160 model turns or 3 hours of wall time gets a journal line and a decision-needed notice naming the unit and the figure, then the runner stops the unit and treats it like a commit-gate miss (chain stops, work parked as today). The two figures live at the top of the runner as named constants.
- [x] Limit retries are capped: after 4 limit waits on one unit the runner stops the chain with a decision-needed notice instead of resetting the streak and re-running; the journal line names the count.
- [x] Defaults: CLAUDE_DEFAULT_MODEL is claude-opus-5; the stale "verify runs on Luna" comment says Terra; a phase file with no model header lands on the engine default the doctrine names (Sol for codex, Opus 5 for claude).
- [x] Journal entries carry the date: `YYYY-MM-DD HH:MM | ...` from the runner and from the journal clause the planner compiles (update the clause text in the phase tail comment near the top of the runner if one exists; the planner updates doctrine).
- [x] The runner (not the compile) stamps the run summary path: the tail's summary path uses the chain's real start date, resolved at chain start and passed to units as an environment value the phase text can reference; document the variable name in the runner header comment.
- [x] Orphaned appends: on any terminal chain event (completed, failed, stopped) the runner reports files still queued under ~/forge-logs/<slug>/append/ in the journal and in the terminal notice text; the watchdog surfaces the count on the chain row.
- [x] Append, amend and remanifest apply the same header validation as initial dispatch (name and tasks required, label caps enforced); a file missing them is refused with the same message.
- [x] A Claude unit that ends with zero Read tool calls gets one journal line saying so (the "Claude out of Bash" check the audit asked for); no other behavior changes.

Done check: runner tests or a stub chain on dev exercise the turn budget (set the constant low for the stub), the retry cap, the dated journal line, the orphan report on a stopped stub chain with one queued append, and the append refusal; the runner's default model line reads claude-opus-5. Commit.

## Job 2 — Tool guard false denials. Verify: yes

Goal: the guard stops blocking legitimate commands and the two copies cannot drift. Evidence: audit-opus-5.md "The tool guard denies 2>/dev/null inside command substitution" (shellWords never strips the closing paren or backtick from a redirect target) and "recursive force delete is banned everywhere" (isRecursiveForceRm never consults allowedRoots), plus the two byte-identical copies at ~/.claude/hooks/git-guard.js and scripts/macos/tool-guard.cjs. Files: scripts/macos/tool-guard.cjs, scripts/macos/install.sh, the runner's boundary reload, guard tests. Dependencies: none.

- [x] resolveTarget strips a trailing `)` or backtick from a redirect target so `$(grep x y 2>/dev/null)`, `echo $(ls 2>/dev/null)` and the backtick form resolve to /dev/null and are allowed; a redirect to a path outside the allowed roots is still denied.
- [x] The recursive force delete rule consults allowedRoots like every other destructive verb: inside the project tree and /tmp it is allowed, outside it stays denied; a target of `/`, `~`, `$HOME`, or a bare `*` stays denied regardless.
- [x] One source: scripts/macos/tool-guard.cjs is canonical; install.sh copies it to ~/.claude/hooks/git-guard.js, and the runner's boundary reload does the same copy when the hashes differ, journaling one line when it does.
- [x] Tests cover the three previously denied substitution forms (now allowed), the scoped delete cases (allowed inside, denied outside, denied for the dangerous targets), and that the destructive git patterns the guard exists for still deny.

Done check: the guard test file passes; running the guard binary by hand against the audit's four reproductions returns allow for the substitutions and the in-project delete and deny for the out-of-tree delete; ~/.claude/hooks/git-guard.js matches the repo copy byte for byte after install.sh. Commit.

## Job 3 — Promote and suite gates. Verify: yes

Goal: promote checks the client too, every promote attempt leaves a record, and a red server suite is visible on the unit that left it. Evidence: audit-codex-sol.md workflow findings 4 and 5 and audit-opus-5.md "Promote's gate misses the client entirely" and "Nothing checks the suite is green before or between units" (ui18 shipped a red tree that cost ui19 Job 0). Files: scripts/macos/promote.sh (checks near line 325), package.json scripts, server/modules/database/schema.ts (watchdog_promotes near 254) plus its repository and the routes that read it, the runner's commit gate. Dependencies: Job 0 (runner).

- [ ] promote.sh runs `npm run typecheck`, `npm test` and `npm run test:client` before the artifact copy and stops on the first failure with the failing command named.
- [ ] Every promote attempt persists: watchdog_promotes (or a successor table with a migration) records started and ended times, the commit, the stage reached, status (passed, failed at stage, rolled back), and a durable log path under ~/forge-logs/promote/<YYYYMMDD-HHMM>/ (build, test, typecheck, client logs kept per attempt, nothing under /tmp).
- [ ] A failed promote sends a decision-needed notice naming the failing stage; the jobs history's promoted divider distinguishes a failed attempt from a promotion.
- [ ] The runner's commit gate runs `npm test` after a unit's commit (server suite only, no rebuild) and records the result on the unit (green or red with the failing test names in job_meta and one journal line); red does not stop the chain.

Done check: a promote dry run on dev with a deliberately failing client test stops at that stage, records the attempt with the log path, and fires the notice; a passing promote records passed; a stub unit with a failing server test shows red in the jobs payload with the test name. Commit.

## Job 4 — Notifications that mean what they say. Verify: yes

Goal: a clean chain end is verified-done, decision-needed is reserved for real decisions, push state is server-acknowledged, every delivery path respects channel policy, taps land on the right session, and queued wakes survive a restart. Evidence: audit-codex-sol.md UX findings 2 and 3, workflow finding 9; audit-opus-5.md "Signals that reach nobody" (sw.js builds its URL from data.sessionId which chain notices never pass; notification taps force the planner slot; queued wake payloads live in an in-memory map). Files: server/modules/watchdog/watchdog.service.ts (handleTerminalChain near 316 to 327, notify near 1165, 1599, 1891, 2241, wake map near 306 and 1612), server/modules/notifications/services/notification-orchestrator.service.js (fleet bypass near 303), public/sw.js (click handler near 105), src/hooks/useWebPush.ts (subscribe near 73 to 95), src/components/settings (push row), src/components/app/AppContent.tsx (tap routing near 342), schema and tests. Dependencies: none.

- [ ] A chain ending completed with no verify failures and no inconclusive verdicts fires verified-done; decision-needed fires only for failed, stopped, a verify FAIL, an inconclusive verdict, a budget stop, or a genuine question; the body reads as a message to Willem, not an instruction to the planner (the planner wake keeps its own prompt).
- [ ] Every chain and run notice carries the unit's sessionId and the chain slug; sw.js deep-links to that session; the client opens dispatch and direct origins in the worker slot and planner origin in the planner slot.
- [ ] Push subscription is acknowledged: isSubscribed flips true only after the server confirms the subscription row; the Settings preference follows the server state; a subscribe failure surfaces its real reason in the row (including iOS Safari not installed to the Home Screen, detected explicitly).
- [ ] Fleet notifications route through the same channel policy as every other kind (per-kind and per-device preferences honored); no delivery path bypasses it.
- [ ] Queued planner wakes of every kind (terminal, recovery, failure, silence, direct-run) persist with their payload and delivery state and drain in order after a server restart; a test restarts the service with two queued wakes and sees both delivered once.

Done check: on dev, a stub chain completing clean produces a verified-done push and a failing stub produces decision-needed; a stub notice's tap URL contains the unit sessionId and opens in the worker slot; the subscribe flow against a stubbed failing endpoint shows the reason in Settings and leaves isSubscribed false; the wake persistence test passes. Commit.

## Job 5 — Jobs data past the first 100. Verify: yes

Goal: the jobs surface stops silently truncating history, progress updates stop triggering a full refetch, and the server exposes the states the column needs. Evidence: audit-codex-sol.md UX finding 4 (backend hard-limits history to 100 of 270 sessions) and audit-opus-5.md "Every punch-list checkbox write triggers a full worker-runs refetch" (chain_progress calls refreshRuns, which returns up to 100 sessions plus every chain manifest plus per-run token usage on a 250 ms debounce). Files: server/modules/watchdog/watchdog.service.ts (runs payload near 1320 to 1446), server/modules/database/repositories/sessions.db.ts (near 546), watchdog routes, the client's worker-runs fetch in src/components/worker-pane/WorkerPane.tsx (near 261 and 362) only as far as consuming the new API shape (the column's look is Job 10). Dependencies: Job 0 (verdict state in the payload).

- [ ] Cursor pagination on the runs and chains history: the route takes a cursor and page size, returns the next page plus the total count; transcript links and token enrichment come per page, lazily; nothing caps at 100.
- [ ] chain_progress emits a compact delta (chain slug, unit, task index, checked state) and the client applies it to the row in place; a full refetch happens only on chain start, unit boundary, and terminal events.
- [ ] The runs payload exposes per unit: verdict state (passed, failed, inconclusive, skipped), verify failure reason, suite result from Job 3, hold requested, budget stop, and the recorded worker commit.
- [ ] A stop route exists beside pause, resume and hold: stop ends the chain as stopped (runner and unit terminated cleanly, work parked as pause does) and is what the app's stop control (Job 9) calls.

Done check: server tests cover pagination (a fixture with 130 sessions pages fully with the right total), the delta event shape, and the stop route; on dev the worker pane loads the first page and the full count without error and a stub chain_progress event updates one row without a runs refetch (network log). Commit.

## Job 6 — Prompts survive a dropped socket. Verify: yes

Goal: a message sent while the socket is down is never lost and its state is honest. Evidence: audit-codex-sol.md UX finding 1 (chat.send stashed in an in-memory cache; the warning claims the server queue). Files: src/contexts/WebSocketContext.tsx (near 189), src/components/chat/utils/chatStorage.ts (near 89, 148, 295), the server's queued-messages module for the acknowledgement and idempotency, the composer's pending state. Dependencies: none.

- [ ] Outbound messages persist locally (IndexedDB or localStorage, per device) with an idempotency key until the server acknowledges receipt; reloading or reopening the tab re-sends unacknowledged ones in order; the server dedupes by key.
- [ ] The composer shows a pending, not-yet-received state for an unacknowledged message (a queued card variant per DESIGN.md) and clears it on acknowledgement; the warning copy says what is true ("saved on this device, sending when connected").

Done check: on dev, kill the socket (server restart) after sending, reload the page, and the message arrives exactly once when the socket returns; a duplicate re-send is dropped by the server; a test covers the dedupe. Commit.

## Job 7 — Housekeeping and prompt tails. Verify: yes

Goal: the repo stops tracking scratch, the dev log stops growing unbounded, and dispatch generates the invariant prompt tail so phase files carry only the job paragraph. Evidence: audit-opus-5.md "32 Playwright console logs are tracked in git", "Disk, not tokens" (dev.out.log 15 MB and growing), spend "Phase prompts are 49% byte-identical boilerplate" and audit-codex-sol.md spend finding 5 (80.6% of phase prompt words repeat), plus "Workers ls and cat the planner lesson tree on 71% of units" (1.22M chars injected). Files: .gitignore, .playwright-mcp, scripts/macos/cloudcli-dev-start.sh or the launchd template for the log, scripts/macos/dispatch (phase assembly), a new scripts/macos/phase-tail template, tests for dispatch. Dependencies: Job 1 (dispatch validation).

- [ ] .playwright-mcp is gitignored and its tracked files removed from the index (not from disk).
- [ ] dev.out.log and the live equivalent rotate at 10 MB (keep three) through the start script or a newsyslog entry the install script writes; document which in the script header.
- [ ] Phase tail generation: dispatch assembles each unit's prompt at fire time from the phase file (headers plus the job paragraph) and one versioned tail template under scripts/macos/phase-tail/ with a shared block (state-change caution, foreground gate, dated journal clause with the resolved journal path, walk-away tail, lessons path, re-grounding close, git close with the resolved summary path from Job 1) and an engine block (codex: no subagents, agent-browser for UI checks; claude: batching, delegation cap, scope and length clauses). A phase file carrying `<!-- tail: inline -->` is sent as written (how this chain's files were compiled). Existing chains' stored files are untouched.
- [ ] Lessons index: at chain start dispatch writes ~/forge-logs/<slug>/LESSONS.md, one line per lesson file from planner/cloudcli/lessons (filename and first line), and the tail points workers at that file instead of the directory; the lessons clause still names the directory for writing.

Done check: git ls-files shows nothing under .playwright-mcp; the rotation config exists and a test or manual run rotates a stub log; dispatch tests assert an assembled prompt equals headers plus job paragraph plus the two blocks for each engine, that the inline marker bypasses assembly, and that LESSONS.md is written at chain start with one line per lesson file. Commit.

## Job 8 — Chain controls and an error surface. Verify: no

Goal: Willem can stop, pause and resume a chain from the app, and every user-initiated failure shows on screen. Evidence: audit-opus-5.md "No stop, pause, resume or append for a running chain" (the client's only chain call is the fast-mode toggle at WorkerPane.tsx:462), "There is no error surface in the app at all" (120 console.error calls, 44 files; model switch, effort, fast mode fail silently; Settings stores saveStatus error but renders only success), audit-codex-sol.md UX finding 7 (search treats an SSE error as a normal end; Jobs sets runsLoaded true on failure). Files: src/components/worker-pane/WorkerPane.tsx and its header, a new app-level message strip component, src/components/chat/view/ChatInterface.tsx (near 579 to 601), src/components/settings (useSettingsController near 228, Settings.tsx near 118), src/components/sidebar/hooks/useSidebarController.ts (near 589), src/components/memory (MemorySurface near 46 and 150), DESIGN.md area files. Dependencies: Job 5 (stop route).

- [ ] The worker pane header carries the chain controls for the active chain: pause or resume as one toggling control, stop behind a confirm sheet (drawer law, safe-area padding on the phone), both reflecting the chain row's state live; disabled with a reason when no chain is running.
- [ ] One app-level message strip: a non-blocking strip on desktop and a bottom sheet on the phone, fed by every user-initiated failure (model, effort and fast-mode switches, chain fast mode, settings save, search stream errors, jobs load failures, memory load failure, push subscribe failure) with the real reason and a retry where one applies; it replaces the console-only paths named in the evidence. Settings renders its error state; a failed save no longer reverts the switch silently.
- [ ] Search distinguishes partial results after a stream error from a clean empty result; the jobs surface distinguishes a failed load from an empty history.

Done check: on dev at desktop and 390 px, pause then resume a stub chain from the header and watch the row state follow; stop asks first and ends the chain; a forced settings save failure shows the strip with the reason; a forced search stream error shows partial-results state. Commit.

## Job 9 — Jobs column truth and touch. Verify: no

Goal: the column shows every state the data now carries, keeps Willem's selection, loads history on demand, and meets the touch law. Evidence: audit-opus-5.md "Every jobs-column target is under 44 px", "The job row's session control is hover-only and reads as a chevron on touch", "Finding a past run is a blind pager", "verifyFailures and holdRequested are fetched and never rendered", "Completed task durations are hover-only"; audit-codex-sol.md UX findings 5 (auto-follow yanks a manual selection after 60 seconds) and 6 (rows 32 px, task rows 20 px). Files: src/components/worker-pane/JobsSidebar.tsx, src/components/worker-pane/workerRunFollow.ts, WorkerPane.tsx (follow logic near 389, runs consumption), design/worker-pane-and-jobs.md. Dependencies: Job 5.

- [ ] Verdict states render distinctly: passed, failed (with the reason on open), inconclusive (with the reason), skipped; suite red shows on the unit; hold requested and budget stop show as states; the chain's terminal line counts inconclusive separately.
- [ ] An explicit selection stays pinned until Willem taps a "follow live" control or selects the live run; no timed snap-back.
- [ ] History loads by page with a visible "N of M loaded" line and a load-more control, plus a search field filtering by slug, job name and task text across loaded pages (fetching more when the filter is set).
- [ ] Touch law: job rows, task rows, the pager, the row's session control and the load-more control get 44 px coarse-pointer hit wrappers without changing the compact visual rows; the session control is visible on touch (META_REVEAL_CLASS pattern); completed durations are visible on touch, not hover-only.

Done check: on dev at 390 px with agent-browser, every listed control's hit box measures at least 44 px; a manual selection survives a live unit boundary; the history line shows the true total and load-more appends a page; a stub inconclusive unit shows the state and reason. Commit.

## Job 10 — Notifications in the app and on the phone. Verify: no

Goal: nothing important is invisible while the app is open, and the phone tells Willem something is waiting. Evidence: audit-opus-5.md "Foreground notifications are invisible" (client draws a toast only for usage-alert), "The unseen-response bell and run counters live only inside the phone's closed sidebar", "Two toast surfaces land under the phone taskbar", "Push subscription fails silently on the phone". Files: src/components/app/AppContent.tsx (fleet_notification handling near 205, toasts near 216 and 516), a notifications drawer, src/components/main-content/view/subcomponents/MobileMenuButton.tsx and MobileTaskbar.tsx, src/components/sidebar/view/subcomponents/ChatRow.tsx (bell), src/components/file-tree (toast near 329), design/mobile.md and the relevant area file. Dependencies: Job 4 (payload shape).

- [ ] Every fleet_notification kind renders in one persistent in-app list (a drawer opened from a bell in the pane header on desktop and from the taskbar on the phone), newest first, each entry opening its session in the right slot; entries mark read on open; the usage-alert toast folds into it.
- [ ] Unseen marks: the hamburger and the Planner and Worker taskbar segments carry a dot when their side has an unseen response or notification; the dot clears on open.
- [ ] Both toast surfaces offset by --mobile-taskbar-offset per design/mobile.md.

Done check: on dev at 390 px, a stub decision-needed and a stub verified-done both appear in the list while the app is open, the taskbar dot appears and clears on open, and toasts sit above the taskbar; desktop shows the same list from the header bell. Commit.

## Job 11 — Phone touch pass: chat, terminal, editor. Verify: no

Goal: the highest-traffic phone controls meet the touch law and the terminal and editor work one-handed. Evidence: audit-opus-5.md "Phone ergonomics" and "Smaller UX items". Files: src/shared/view/ui/PromptInput.tsx (send/stop near 246), src/components/chat (ChatComposer near 491, ChatInterface scroll-to-bottom near 817, VoiceInputButton near 33, useVoiceInput near 108), src/components/shell/view/Shell.tsx (choice bar near 312) and TerminalShortcutsPanel.tsx (near 113 to 114), src/components/code-editor (settings.ts near 9, CodeEditorHeader near 193, the footer string in en/codeEditor.json), src/components/command-palette/CommandPalette.tsx and AppContent.tsx (trigger near 504), src/components/settings (SystemSettingsTab input near 338, AppearanceSettingsTab dots near 74), design/mobile.md. Dependencies: none.

- [ ] Send/Stop and scroll-to-bottom carry touch-hit (44 px on coarse pointers) without changing their desktop look.
- [ ] Terminal: the numbered-choice bar sits above the on-screen key bar (z-order fixed), and the key bar shows a scroll cue (edge fade) so Ctrl+C is discoverable at 390 px.
- [ ] Editor: word wrap defaults on at phone widths; unsaved edits are tracked and closing with dirty content asks first (sheet on the phone); the close control is labeled and spaced from Save; the "Ctrl+S to save" footer shows only where a keyboard exists.
- [ ] The command palette has a trigger in the phone pane header and opens as a full-height sheet.
- [ ] Voice errors wrap and stay until dismissed or replaced; theme preview dots are visible without hover; inputs pinned under 16 px on iOS move to 16 px so Safari stops zooming; the shell Disconnect control asks first.

Done check: on dev at 390 px with agent-browser, hit boxes for send/stop and scroll-to-bottom measure at least 44 px; the choice bar is above the key bar in the DOM stacking order; opening the editor on a long line shows wrapped text; closing a dirty editor shows the sheet; the palette opens from the header. Commit.

## Job 12 — Phone touch pass: git, files, dialogs. Verify: no

Goal: git and file work is possible on the phone without right-click or 16 px targets. Evidence: audit-opus-5.md "Every file action is behind right-click", "Git changes controls are 16 to 24 px, Discard among them", "Destructive git and file dialogs are centered desktop modals", "The branch picker autofocuses inside a 256 px desktop popover", "File-tree rows are about 22 px", "Renaming a file commits on blur", "The mobile Commit 3 files button does not commit", "Git header actions lose their labels on mobile", "The M/A/D/U badges have no explanation on the phone", "The image viewer cannot zoom". Files: src/components/file-tree (FileContextMenu near 309 and 358, FileTreeNode near 120 to 151, FileStatusLegend near 20, ImageViewer near 80), src/components/git (FileChangeItem near 46, ChangesView near 229, GitPanelHeader near 64, 170 and 252, CommitComposer near 85 and 108, NewBranchModal near 51 and sibling modals, RemoveWorktreeModal near 69), design/mobile.md. Dependencies: none.

- [ ] File actions on touch: long-press and a row overflow control open the same action set as right-click, as a sheet; dismissal works by tap outside and by the sheet's own close.
- [ ] File-tree rows and git change controls (checkbox, chevron, Discard) get 44 px hit wrappers; the legend renders on the phone; rename commits on Enter and cancels on blur.
- [ ] Destructive git and file dialogs (new branch, delete, discard, remove worktree and siblings) become sheets with safe-area padding and 44 px actions; the em dash in the worktree copy goes.
- [ ] The mobile commit control does what its label says: a "Write message" step then a "Commit" action, no keyboard-combination hint on touch; git header actions keep distinguishable icons (Fetch and Refresh, Publish and Push each get their own) and a label on touch.
- [ ] The branch picker does not autofocus on touch; the image viewer supports pinch and double-tap zoom.

Done check: on dev at 390 px with agent-browser, long-press on a file row opens the action sheet; the listed controls measure at least 44 px; every listed dialog renders as a sheet; the commit flow lands a commit on a scratch file in a dev worktree and cleans it up. Commit.

## Job 13 — Labels and times that tell the truth. Verify: no

Goal: every time Willem reads is 12-hour Eastern, copy says only what is true, and explainer text goes. Evidence: audit-opus-5.md "Labels that lie or lag", "Explainer copy he does not want", "'Claude needs your input' is hard-coded", "A failed memory load is indistinguishable from an empty one", "A fully empty transcript renders literally nothing", "Two native browser dialogs remain". Files: src/components/git (CommitHistoryItem near 11 and 95), src/components/chat (MessageComponent timestamp near 394, chatFormatting reset time near 93, AskUserQuestionPanel near 205, useChatComposerState confirm near 501, chatExport alert near 188, ChatMessagesPane empty state near 348), src/components/prompt-history (PromptHistoryPanel near 43), src/components/file-tree/utils (fileTreeUtils near 76), src/components/memory (MemorySurface), src/components/sessions (ActiveSessionsDrawer near 84 and 106), src/components/settings (SystemSettingsTab descriptions near 67), design/tokens or the area file that owns time formatting. Dependencies: none.

- [ ] One shared time formatter (12-hour, America/New_York, no seconds, date when not today) used by commit history, the transcript timestamp, prompt history, the file tree and the usage-limit reset line; remove the per-component host-locale formatting.
- [ ] The question panel names the provider that asked; the memory surface shows a distinct failed-load state with retry; an empty transcript shows the app's empty state rather than nothing; the two native dialogs become the app's sheet and strip.
- [ ] Copy pass: the explainer lines in the active sessions drawer go; System tab descriptions say what each switch does to Willem in plain words (no runner jargon); no em dashes remain in UI strings (grep the locale files and components).

Done check: on dev, a commit from a known UTC timestamp renders as the expected Eastern 12-hour string in every listed place; the question panel on a Codex stub session names Codex; grep for em dashes across src and the locale files returns nothing in UI strings. Commit.

## Job 14 — Transcript performance and the rotate nudge. Verify: no

Goal: long runs render as readable transcripts on the phone, and the context ring tells Willem when to rotate. Evidence: audit-opus-5.md "Live tool rows never group, and mixed-tool runs never group at all" (an Opus unit at 291 turns is a 291-row ladder), "Both chat panes are mounted at once on the phone", "The context ring shows no number and never changes colour", spend finding 1 (rotate at roughly 120 to 150k context). Files: src/components/chat/utils/toolGrouping.ts (near 69), ChatMessagesPane.tsx (near 118), src/components/main-content/view/MainContent.tsx (near 443 and 476), src/components/chat/view/subcomponents/TokenUsageSummary.tsx (near 162 and 192), design/transcript-rows.md and design/mobile.md. Dependencies: none.

- [ ] Tool rows group live, not only after hydration, and consecutive tool rows of mixed tools collapse into one group labeled by count and tool set, with the assistant's text always its own visible row.
- [ ] On the phone only the active pane is mounted; switching panes restores scroll position; the 10 Hz tickers run only for the mounted pane.
- [ ] The context ring shows the percentage as a number beside it, turns amber past 120k tokens and red past 200k, and past amber carries a short "rotate soon" hint in the ring's hover and the phone's tap sheet; nothing acts automatically.

Done check: on dev, a fixture transcript with 200 mixed tool rows renders under 30 rows collapsed while streaming; the phone DOM holds one pane's transcript at a time; a stub session with 130k context shows the amber ring with the number. Commit.
