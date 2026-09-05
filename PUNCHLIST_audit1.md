# PUNCHLIST_audit1 — the September 4 full audit: verify truth, runner budgets, promote gate, notifications, chain control, phone ergonomics, spend visibility

## Goal

Two read-only audits (Codex GPT-5.6 Sol and Claude Opus 5, 2026-09-04, reports at ~/Projects/spoton-worker/review-20260904/) went over the whole build with three lenses: user experience, workflow gaps, wasted tokens. This chain lands everything both reports agreed on that needs no decision from Willem. Harness and runner jobs run first on Codex so their fixes reach the later units through the runner's boundary reload; UI jobs run after on Opus 5. Dev-first, end-to-end verification, promote without an eyeball gate.

## Stack and decisions already made

- Each job carries "Verify: yes" (fresh-context Terra verifier) or "Verify: no" (UI-only; after Job 0 lands, "no" means the render-sanity pass Job 0 builds).
- Standing laws: personal-tool wording, drawers and sheets never centered popups, ramped motion, monochromatic with semantic status color, DESIGN.md consistency (read only the design/ area files your files touch), mobile parity with 44px targets and 16px inputs, no em dashes in UI copy, label caps (job names 24 chars, task labels 40), rebuild discipline, pathspec commits for any planner files.
- Timestamps Willem reads are 12-hour America/New_York with am or pm, everywhere in the app, regardless of host timezone.
- Locked and not up for change in this chain: verify runs in the background while the next unit builds (a change is Willem's call); the commit gate stays terminal; planner auto-rotation stays off; the tool guard's blanket rm -rf ban stays; the MCP server list in ~/.claude.json stays.
- Locked decisions carried from PROJECT.md: notifications are decision-needed, verified-done and recovery; a failed verify records and continues; every append is a phase; headless Claude units run acceptEdits with the allowlist; Fable never runs a job.

## Whole-file rules

- Read DESIGN.md (the index) before UI work and only the design/ area files your files touch; reuse the closest existing element; a genuinely new element gets appended to its area file.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Check each item off in this file the moment it is verified, in its own small commit or at least its own file write, never all at once at job end: the jobs column reads this file live.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM and snapshot on dev (port 4748, config ~/.claude-dev, DB ~/.cloudcli-dev/auth.db); confirm visible changes at a phone viewport (iPhone 14 device emulation) as well as desktop.
- Codex jobs: browser and UI checks use agent-browser against dev; do not spawn subagents; the runner's verify stage is the fresh-context check, so skip any "fresh-context subagent" wording. Opus jobs: delegate only large, genuinely independent tracks; group shell work into one call; read files with the Read tool in the ranges you need and never a file over 20 KB whole; do not narrate between tool calls.
- Never read the lessons folder wholesale: the only lesson read is the one-line index if it exists, otherwise skip lessons entirely.
- Rebuild and restart dev only when the done check needs the running instance to show the change, never twice when once serves. Server-only or test-verifiable work runs its tests without a rebuild.
- On unrecoverable failure stop and state what blocks. You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0 — Verify truth. Verify: yes

Goal: the verify stage tells the truth and stops fooling itself. Today the runner sends `verify-end` for PASS and INCONCLUSIVE alike and the server records both as passed (`scripts/macos/dispatch-chain-runner` around line 981, `server/modules/watchdog/watchdog.service.ts` around line 1139); 19 of 45 recent verifiers were INCONCLUSIVE, most for environmental reasons (untracked .dispatch files reading as a dirty tree, the verifier pointed at the wrong commit, a dev restart under the verifier's browser); and the render-sanity pass promised for UI-only jobs (`Verify: no`) was never built, so those units get no check at all. Files: dispatch-chain-runner (verify stage, verify prompt, unit reconciliation), watchdog.service.ts (verify events, chain job_meta, chain-end summary), watchdog routes and their tests, `src/components/worker-pane/JobsSidebar.tsx` and `WorkerPane.tsx` only where a verdict is displayed. Dependencies: none; runs first.

- [ ] INCONCLUSIVE is a first-class verdict end to end: the runner emits a distinct event, the server stores it on the unit, the jobs column shows it as its own state (not the passed check, not the failed mark), the chain-end summary and the planner wake count it separately ("N verify failures, M inconclusive"), and a chain with inconclusive units never reports itself fully verified.
- [ ] A mechanical pre-check runs before the verifier is spawned: the tree-clean test ignores untracked files under `.dispatch/` and `.playwright-mcp/`, and the verify range is the unit's own commits (BASE..HEAD of that unit, `docs(` commits excluded) with the range and the unit's commit hashes written into the verify prompt, so "working tree is not clean" and "the behavior is in a different commit" can no longer be verdicts.
- [ ] The verify prompt carries only what a verifier needs: the unit's identity (slug, job number, name), the job's punch-list section, its done check, the commit range and diff stat, and the run rules; it no longer embeds the whole builder prompt (dispatch-chain-runner around line 889).
- [ ] The render-sanity pass exists: a `Verify: no` unit gets a short Terra verify session whose whole task is a DOM pass on dev (the elements the job's checklist names exist, are visible, and respond; agent-browser snapshot, no review of intent), reporting PASS, FAIL or INCONCLUSIVE through the same events; the jobs column labels it as the render pass so it reads differently from a full verify.
- [ ] The runner's phase-end journal line and the unit's stored commit record the worker's own commit (the newest non-`docs(` commit in the unit's range), never a concurrent planner docs commit that happened to move HEAD.

Done check: on dev with a stub chain of two units (one `Verify: yes`, one `Verify: no`): the full verifier returns INCONCLUSIVE on a deliberately unverifiable done check and the unit shows the inconclusive state in the jobs column and the chain-end summary counts it; the same unit with a real done check returns PASS with the pre-check having ignored untracked .dispatch files; the `Verify: no` unit shows a render-pass row that reports PASS; the server suite passes. Commit.

## Job 1 — Runner budgets and defaults. Verify: yes

Goal: a wedged unit cannot run forever, and the runner's defaults match the decisions. Today there is no per-unit turn, time or retry cap (a limit-retry loop resets its streak after each wait, `dispatch-chain-runner` around line 538), the Claude default model is `claude-fable-5` (line 67, the planner-only model, a superseded id), a comment still says verify runs on Luna (line 75), journal lines carry only HH:MM (line 213) so multi-day journals read out of order, an append queued into `~/forge-logs/<slug>/append/` is never reported when the chain stops before consuming it (pickup runs only after a successful commit gate, around line 1269), and `dispatch append` accepts a phase file with no name or tasks while the initial dispatch refuses it (`scripts/macos/dispatch` around lines 448 and 585). Files: dispatch-chain-runner, dispatch, watchdog.service.ts (terminal chain handling), their tests. Dependencies: Job 0.

- [ ] Per-unit soft budget: a unit that passes 80 assistant turns or 3 hours of wall time gets one journal line and a decision-needed notice naming the unit and the count; at 120 turns or 4 hours the runner ends the unit (the commit gate then stops the chain as today, which is the accepted backstop). Both thresholds live at the top of the runner as named variables.
- [ ] The session-limit retry loop has a hard cap of 6 waits per unit; the seventh ends the unit with a journal line and a decision-needed notice.
- [ ] `CLAUDE_DEFAULT_MODEL` in the runner is `claude-opus-5`; the Luna comment goes; every model, engine and effort default in the runner and dispatch matches PROJECT.md's worker seat (Codex gpt-5.6-sol high for backend, Opus 5 high for UI, Terra for verify).
- [ ] Journal lines carry the date: `YYYY-MM-DD HH:MM | phase or task | event | detail`, Eastern time.
- [ ] Any terminal chain event (completed, stopped, failed) reports unconsumed append files in the journal, the chain-end summary and the planner wake, naming each file.
- [ ] `dispatch append`, `amend` and `remanifest` validate phase headers exactly as the initial dispatch does (name and tasks required, label caps enforced) and refuse with the same message.

Done check: a stub unit whose prompt loops on a trivial task trips the 80-turn notice and the 120-turn end (use test-sized thresholds through the named variables, then restore them); the runner and dispatch tests pass with the new defaults; `dispatch append` on a file missing its tasks header refuses; a stub chain stopped with a queued append names the file in its journal and wake; a journal written today shows dated lines. Commit.

## Job 2 — Promote gate and record. Verify: yes

Goal: promote checks the client it ships and leaves a trail when it fails. Today `scripts/macos/promote.sh` (around line 325) runs `npm run build` then `npm test`, which is the server suite only; the 42 client test files (`test:client`) and `npm run typecheck` never run before live; build and test logs go to fixed /tmp paths overwritten by the next attempt; and `watchdog_promotes` records completed promotions only (`server/modules/database/schema.ts` around line 254). Units also land on a red server suite without noticing (ui18 units 1 and 4 left three failing tests "for the dispatch owner"). Files: promote.sh, package.json scripts, schema.ts and the promotes repository, watchdog.service.ts (promote records), dispatch-chain-runner (commit gate), the jobs column only where a promote row renders. Dependencies: Job 0.

- [ ] One release check command (`npm run check:release`) runs typecheck, lint, the server suite and the client suite; promote.sh runs it after the build and before any artifact copy, and a red result aborts the promote before live is touched.
- [ ] Every promote attempt is recorded: a row with start time, stage reached, status (running, failed, completed, rolled back), the commit, duration and the durable log path under `~/forge-logs/promote-<stamp>.log`; the jobs column's promoted divider shows failed attempts too, and a failed promote sends a decision-needed notice with the failing stage.
- [ ] The commit gate runs the server suite after each unit's commit and records a red result on the unit (journal line plus a unit flag the jobs column shows), continuing the chain like a verify failure; the chain-end summary lists red units.

Done check: with a deliberately failing client test on dev, `promote.sh` aborts before copying artifacts and records a failed attempt with the right stage and log path, visible in the jobs column; with the test fixed, promote completes and records the attempt; a stub unit that commits with a failing server test shows the red flag and the chain continues. Do not run a real promote against live in this job beyond the abort path; the completed path is verified against the dev copy step. Commit.

## Job 3 — Wakes that survive and a planner that resumes. Verify: yes

Goal: no planner wake is lost to a restart, and promote no longer leaves the planner dead until Willem types. Today queued wake prompts live in an in-memory map (`watchdog.service.ts` around lines 306 and 1612); only terminal chains persist `wakePending`; and after promote restarts the server the planner's severed turn has no resume path (`sessions.db.ts` around line 770 marks any pending boot as failed; PROJECT.md records the gotcha). Files: watchdog.service.ts, the watchdog repositories and schema, sessions.db.ts, promote.sh only to post the promote result, tests. Dependencies: Job 2.

- [ ] Every queued wake (terminal, recovery, failure, silence, direct-run) persists with its payload, target session and delivery state, and is drained once, in order, after a restart.
- [ ] When a promote completes and the server is back, the watchdog sends the planner session that ran the promote (or the newest open planner session when that lineage is gone) a wake carrying the promote result (commit, health, duration), so the planner resumes without Willem typing.

Done check: queue a stub wake, restart the dev server, the wake is delivered exactly once; run the dev-side promote path and the promoting planner session receives the promote-result wake as a new turn; the server suite passes. Commit.

## Job 4 — Notification truth. Verify: yes

Goal: notifications mean what they say and reach the phone. Today every terminal chain, including a clean completion, fires decision-needed (`watchdog.service.ts` around lines 316 to 327); the push payload never carries the unit's session id so a tap opens the app home (`public/sw.js` around line 105); the client sets `isSubscribed` without checking either HTTP response and swallows the subscribe error, so an iPhone can show push enabled with zero subscriptions in the database (`src/hooks/useWebPush.ts` around lines 73 to 95, `push_subscriptions` count was 0 during the audit); fleet notifications bypass channel preferences (`server/modules/notifications/services/notification-orchestrator.service.js` around line 303). Files: watchdog.service.ts, notification-orchestrator.service.js, public/sw.js, useWebPush.ts, the notifications settings tab, tests. Dependencies: Job 0.

- [ ] A clean chain completion fires verified-done; decision-needed fires only for stopped, failed, a verify failure, an inconclusive verdict, a budget notice, or a genuine question.
- [ ] Every chain notification carries the unit's session id and chain slug; the service worker opens the worker pane on that session; a chain-level notice with no unit opens the chain in the jobs column.
- [ ] Push subscription is server-acknowledged: the client marks subscribed only when the server stored the subscription, surfaces the actual error text in the settings row (including the iOS case where the site is not installed to the Home Screen, detected and explained in one plain line), and the settings switch reflects the server state.
- [ ] Fleet notifications go through the same channel policy as everything else.

Done check: on dev, a stub chain completing cleanly produces a verified-done notice and a stopped one produces decision-needed; a notice payload carries sessionId and chainSlug and the service worker's navigate message targets the worker session; subscribing on a browser that rejects push shows the error text and leaves the switch off; the suite passes. Commit.

## Job 5 — Tool guard fix and repo hygiene. Verify: yes

Goal: the guard stops blocking harmless commands and the two guard copies cannot drift. Today `scripts/macos/tool-guard.cjs` resolves a `2>/dev/null` inside `$( )` or backticks to `/dev/null)` (the closing paren is kept, around lines 71 to 103 and 194 to 235) and denies it, which cost real turns in three chains; `~/.claude/hooks/git-guard.js` and tool-guard.cjs are byte-identical copies kept in sync by hand; 32 Playwright console logs under `.playwright-mcp/` are tracked in git. Files: tool-guard.cjs and its tests, a new check script, package.json, .gitignore. The rm -rf ban stays as is. Dependencies: none.

- [ ] `resolveTarget` strips a trailing `)` or backtick from a redirect target; tests cover `x=$(grep -c foo bar 2>/dev/null)`, `echo $(ls 2>/dev/null)` and the backtick form, all allowed, while the existing denials still hold.
- [ ] `npm run check:guard-sync` fails when `~/.claude/hooks/git-guard.js` and `scripts/macos/tool-guard.cjs` differ, prints the diff, and `check:release` (Job 2) includes it; copy the fixed guard to `~/.claude/hooks/git-guard.js` so the check passes now.
- [ ] `.playwright-mcp/` is ignored and untracked.

Done check: guard tests pass including the three new cases; `check:guard-sync` passes; `git ls-files .playwright-mcp` prints nothing. Commit.

## Job 6 — Phase prompts from a template. Verify: yes

Goal: the planner stops hand-writing 49 percent boilerplate into every phase file. Today each phase file carries the whole run tail (state-change caution, foreground gate, journal clause, walk-away tail, lessons clause, re-grounding block, close and summary-back), 2,337 identical bytes per file across the last 28 units, and a missing clause is a compile bug; workers also walk the lessons folder on 71 percent of units, injecting about 300k tokens per chain. Files: dispatch, dispatch-chain-runner, a new template under scripts/macos/, tests. Dependencies: Job 1.

- [ ] A phase file may be headers plus the job paragraph only; at dispatch time `dispatch` appends the standard tail from `scripts/macos/phase-tail.md` with the slug, project, journal path, lessons path (`~/Projects/spoton-worker/planner/<project>/lessons/`) and summary path (`~/Projects/spoton-worker/planner/<project>/sessions/<slug>-summary.md`) substituted; the tail has an engine-specific block (Codex: no subagents, the verify stage is the check; Claude: delegation cap, batching, Read in ranges and never a file over 20 KB whole, no narration between calls); the runner reads the rendered file, and the rendered files are what `.dispatch/<slug>/` stores so the record stays self-contained.
- [ ] A phase file that already carries a tail (the marker line the template starts with) is left alone, so existing chains and appends keep working.
- [ ] Dispatch writes `<lessons path>/_index.md` at dispatch time: one line per lesson, the file's first line truncated to 160 characters; the tail tells the worker to read only that index and open a lesson only when its line is relevant.

Done check: dispatching a stub chain whose phase files are headers plus one paragraph produces rendered files with the correct tail and paths, the runner runs them, and the lessons index exists with one line per file; a phase file that already has the tail is unchanged; dispatch tests pass. Commit.

## Job 7 — Chain control in the app. Verify: no

Goal: Willem can stop, pause, resume and add to a running chain from the app, desktop and phone. Today the server has pause, resume, hold and append routes (`server/modules/watchdog/watchdog.routes.ts` around lines 378 to 431) and the only chain call the client makes is the fast-mode toggle (`src/components/worker-pane/WorkerPane.tsx` around line 462); a chain going wrong at night can only be stopped through a planner turn. Files: WorkerPane.tsx, JobsSidebar.tsx, the worker pane header, a new append sheet, design/worker-pane-and-jobs.md. Dependencies: Job 1.

- [ ] The worker pane header (desktop) and the job row menu (both form factors) carry Pause, Resume and Stop for the active chain, each calling the existing route; Stop confirms in a sheet, never a centered popup; the row shows paused and stopped states live.
- [ ] "Add a job" opens a sheet with a name field, a tasks field (pipe separated, label caps enforced inline) and a prompt textarea; submitting writes the phase file through the append route as a `--phase` unit and the new row appears in the jobs column.
- [ ] The verifyFailures and holdRequested values already fetched render on the chain row (a count and a held mark).

Done check: on dev with a stub chain: pause, resume and stop each change the row state and the chain record; adding a job appends a phase unit that the runner picks up at the next boundary; the actions are reachable and 44px on the phone viewport. Commit.

## Job 8 — One error surface and foreground notices. Verify: no

Goal: a failure never looks like nothing happened. Today the app has no error surface at all (120 console.error calls across 44 files are the only channel): model switch, effort, fast mode, chain fast mode, settings saves, search, jobs loads all fail silently (`ChatInterface.tsx` around lines 579 to 601, `WorkerPane.tsx` around lines 261 and 459, `useSettingsController.ts` around line 228, `useSidebarController.ts` around line 589, `SystemSettingsTab.tsx` around line 190); with the app open only usage alerts draw a toast (`AppContent.tsx` around line 205), so a verify failure in the foreground is a chime and nothing else; the unseen-response bell is only inside the closed phone sidebar; a failed memory load renders as "Nothing remembered yet". Files: a new app-level message strip component, AppContent.tsx, the hooks and controllers named, MobileMenuButton.tsx, MobileTaskbar.tsx, ChatRow.tsx, MemorySurface.tsx, design area files. Dependencies: Job 4.

- [ ] One app-level message strip (bottom sheet on the phone, offset by the taskbar), fed by every user-initiated failure named above with the real error text and a retry where one makes sense; settings saves show a failed state instead of reverting the switch silently; search shows partial results as partial.
- [ ] All notification kinds render in the foreground in one persistent in-app list (opened from the bell), each row opening its session or chain; the taskbar Worker segment and the hamburger carry an unseen dot.
- [ ] A failed memory load says it failed, distinct from empty.

Done check: on dev, forcing a failed model switch, a failed settings save and a failed jobs load each shows the strip with the error text; a stub decision-needed and verified-done notice each appears in the list and its tap opens the right session; the dots show on the phone viewport; the memory failure state renders. Commit.

## Job 9 — Phone ergonomics. Verify: no

Goal: everything Willem taps on the iPhone is tappable, and nothing hides behind hover or a keyboard. Findings with locations: send and stop 28px with no touch-hit (`src/shared/view/ui/PromptInput.tsx` around line 246, `ChatComposer.tsx` around 491); every jobs-column target under 44px (`JobsSidebar.tsx` around 1046, 1172, 1228, 1305) and the row session control hidden behind hover (around 1189); file-tree rows about 22px (`FileTreeNode.tsx` around 120); git change controls 16 to 24px including Discard (`FileChangeItem.tsx` around 46, `ChangesView.tsx` around 229); inputs at 12 to 14px that make iOS zoom (`SystemSettingsTab.tsx` around 338, `FileTreeHeader.tsx` around 201, `FileTreeNode.tsx` around 151); the terminal's numbered-choice bar under the key bar (`Shell.tsx` around 312 z-10 versus `TerminalShortcutsPanel.tsx` around 113 z-20) and the key bar scrolling sideways with Ctrl+C off-screen (around 114); the code editor opening with word wrap off (`settings.ts` around 9); the branch picker autofocusing inside a popover (`GitPanelHeader.tsx` around 64 and 170); destructive git and file dialogs as centered modals (`NewBranchModal.tsx` around 51 and siblings); two toasts under the taskbar (`FileTree.tsx` around 329, `AppContent.tsx` around 216 and 516); the command palette Cmd+K only (`CommandPalette.tsx` around 86); file actions behind right-click with mousedown-only dismissal (`FileContextMenu.tsx` around 309 and 358); closing the editor discarding unsaved edits (`CodeEditorHeader.tsx` around 193); the mobile "Commit N files" button expanding a textarea that says Ctrl+Enter (`CommitComposer.tsx` around 85 and 108); rename committing on blur (`FileTreeNode.tsx` around 148); the image viewer unable to zoom (`ImageViewer.tsx` around 80); Disconnect with no confirm (`ShellHeader.tsx` around 60); scroll-to-bottom 32px (`ChatInterface.tsx` around 817); theme dots hover-only (`AppearanceSettingsTab.tsx` around 74); the M/A/D/U legend returning null on the phone (`FileStatusLegend.tsx` around 20); git header icons losing labels with Fetch and Refresh sharing one icon (`GitPanelHeader.tsx` around 252). Files: those named; design/mobile.md. Dependencies: none among UI jobs; runs after Job 8.

- [ ] Every control above meets 44px on coarse pointers through the existing touch-hit pattern or a hit wrapper, keeping the compact visual rows.
- [ ] Every text input is at least 16px on the phone.
- [ ] The terminal choice bar sits above the key bar and the key bar shows a scroll cue with Ctrl+C reachable at 390px.
- [ ] The editor wraps on the phone, tracks dirty state and confirms before discarding; rename commits on Enter and cancels on blur.
- [ ] Destructive git and file dialogs and the two toasts become sheets and taskbar-offset toasts per design/mobile.md; the branch picker does not autofocus on touch.
- [ ] The phone gets a search control opening the command palette as a full-height sheet, a long-press plus overflow button for file actions, a commit button that commits, a visible legend, distinct git header icons with labels, tappable theme swatches, a zoomable image viewer, and a confirm on Disconnect.

Done check: on dev at the iPhone 14 viewport, each listed control measures at least 44px in the DOM, no input is under 16px, the choice bar renders above the key bar, the sheets open where modals were, and each new phone affordance is reachable by tap; desktop unchanged. Commit.

## Job 10 — Labels, times and the rotation nudge. Verify: no

Goal: nothing on screen lies, lags or reads in the wrong timezone. Findings: commit history prints raw ISO strings and the expanded row uses device timezone (`CommitHistoryItem.tsx` around 11 and 95); the transcript timestamp uses host locale with seconds (`MessageComponent.tsx` around 394); the usage-limit reset time renders 24-hour (`chatFormatting.ts` around 93); host timestamps in prompt history and the file tree (`PromptHistoryPanel.tsx` around 43, `fileTreeUtils.ts` around 76); "Claude needs your input" hard-coded on the question panel for Codex too (`AskUserQuestionPanel.tsx` around 205); explainer copy ("Tap a session to open it", "Active work will appear here", jargon descriptions in the System tab: `ActiveSessionsDrawer.tsx` around 84 and 106, `SystemSettingsTab.tsx` around 67); an em dash in `RemoveWorktreeModal.tsx` around 69; Escape aborting a turn with no confirm (`ChatInterface.tsx` around 529); the voice error pill overflowing and vanishing in 4 seconds (`VoiceInputButton.tsx` around 33, `useVoiceInput.ts` around 108); the context ring with no number and no colour threshold (`TokenUsageSummary.tsx` around 162 and 192); completed durations hover-only (`JobsSidebar.tsx` around 1260); a fully empty transcript rendering nothing (`ChatMessagesPane.tsx` around 348); a window.confirm and a window.alert (`useChatComposerState.ts` around 501, `chatExport.ts` around 188); the permanent "Press Ctrl+S to save" footer (`en/codeEditor.json` around 32); auto-follow yanking a manually selected run back after 60 seconds (`workerRunFollow.ts` around 8 and 43, `WorkerPane.tsx` around 389); the jobs pager being a blind Newer/Older with no search (`JobsSidebar.tsx` around 18 and 1300). Files: those named; design area files. Dependencies: Job 0 for the inconclusive state.

- [ ] Every owner-facing time is 12-hour America/New_York with am or pm through the one shared formatter the jobs column already uses; no ISO strings, no seconds, no 24-hour.
- [ ] The question panel names the provider; explainer and jargon copy goes or becomes one informative line; the em dash goes.
- [ ] Escape confirms before aborting a running turn; the voice error wraps and stays until dismissed; the context ring shows the percentage and turns amber past 15 percent and red past 40 percent of the window (the rotation nudge, no automatic action); durations show on the row; an empty transcript shows an empty state; the native confirm and alert become sheets; the editor footer shows only the shortcuts the form factor has.
- [ ] A manually selected run stays pinned until Willem picks "follow live" or the live run; the jobs column gets a search box filtering by slug, job name and status, and the inconclusive verdict state from Job 0 renders as its own mark.

Done check: on dev, a commit row, a transcript row, a prompt-history row, a file-tree row and a stub usage-limit line all render Eastern 12-hour; the ring shows a number and the amber and red states with stub values; a pinned run survives a newer unit starting; the search box filters a stub chain; the sheets replace the native dialogs. Commit.

## Job 11 — Spend visible and the jobs column cheap. Verify: no

Goal: Willem sees what a chain cost without an audit, and the jobs column stops hammering the server. Findings: the history surface is hard-limited to 100 sessions with no count shown (`watchdog.service.ts` around 1320, `sessions.db.ts` around 546, `WorkerPane.tsx` around 508; 270 exist for this project); token figures are per unit only, no chain total, builder and verifier split, fresh versus cache, or trend (around 1435 and 508); every punch-list checkbox write triggers a full worker-runs refetch with every chain manifest and per-run token usage on a 250ms debounce (`WorkerPane.tsx` around 362, `watchdog.service.ts` around 1325 to 1446); live tool rows never group and mixed-tool runs never group (`toolGrouping.ts` around 69, `ChatMessagesPane.tsx` around 118); both chat panes are mounted at once on the phone (`MainContent.tsx` around 443 and 476). Files: those named plus the watchdog runs route; design/worker-pane-and-jobs.md. Dependencies: Job 0.

- [ ] History is cursor-paginated with lazy transcript and token enrichment and a visible "N of M loaded" count; nothing is silently cut.
- [ ] Each chain row shows its total tokens split builder, verifier and fresh versus cache, and the chain drawer shows per-unit figures against the chain's median so an expensive unit stands out.
- [ ] `chain_progress` and unit events carry their delta and the client patches the row in place; the full refetch happens only on open, on reconnect, and on a chain starting or ending.
- [ ] Tool rows group while live and across mixed consecutive tools by the same rule, so the assistant's text is not buried in a ladder; the phone mounts only the visible chat pane.

Done check: on dev, the jobs column shows the loaded count and pages through all sessions; a stub chain shows the split totals; a stub `chain_progress` event patches one row without a runs refetch (network panel shows none); a live stub transcript groups tool rows; only one chat pane exists in the phone DOM. Commit.
