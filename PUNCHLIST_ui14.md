# PUNCHLIST_ui14 — jobs column rules, worker top bar, memory editing, account switcher revamp, settings, then harness hardening

## Goal

Willem's correction round on ui13 plus the harness hardening the audit prescribed. Several ui13 items were misread: the jobs column stays a side column for one or two open projects (full-pane takeover only at three), the run history is one continuous list, the worker title dropdown really does go away, and the worker pane keeps its Worker label. Memory becomes a single curated view with a one-off edit prompt. The account switcher gets a full revamp. Jobs 7 through 10 are backend hardening from AUDIT_harness_20260825.md. Dev-first, end-to-end verification, promote without an eyeball gate.

## Stack and decisions already made

- Jobs surface rules (Willem 2026-08-26): with one or two projects open (side-by-side or stacked) the jobs view is a side column inside that project's worker pane; with three or more projects in columns the same toggle makes jobs take over the entire worker pane. The toggle is the job sign icon alone, top-right of the worker pane. The "Job N of N" strip below the top bar is removed entirely.
- Job history is one continuous bottom-to-top list across runs (newest on top, older runs pushed down, scroll for history). No "Other runs" section.
- Memory is one curated view (WILLEM.md in the spoton-worker repo at planner/_global/); no Internals tab, no Project/Global toggle. Edits happen through a one-off prompt box at the bottom, Claude.ai style.
- cswap accounts are added by logging in (`claude /login` in a terminal) then `cswap add`; there is no API-key or setup-token path in Willem's world.
- Standing laws: personal tool wording (no explainer copy), drawers not popups, ramped motion, semantic color at task level only, DESIGN.md consistency, mobile parity, no em dashes in UI copy, label caps (job names 24 chars, tasks 40).
- Rebuild discipline: rebuild/restart dev only when the done check needs the running instance; tests without rebuilds where they suffice.

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to DESIGN.md.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Keep each job under 5 concurrent subagents. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 1 — Jobs column rules and one continuous list

Goal: the jobs view behaves exactly as decided above. Files: the worker pane and jobs view components, workspace layout rules, DESIGN.md. Dependencies: none.

- [ ] Jobs is a side column inside the worker pane whenever one or two projects are open (side-by-side or stacked); at three or more projects in column view the toggle takes over the whole worker pane instead. One toggle: the job sign icon, top-right of the worker pane, no text. The current per-project switcher behavior at one or two projects is replaced by the column.
- [ ] Remove the "Job N of N" strip under the top bar entirely; nothing replaces it.
- [ ] The job list is one continuous bottom-to-top list across all of the project's runs: newest job on top, older runs' jobs continue downward, scrollable; the "Other runs" section is deleted. Commit footers, durations, drawers, and counters carry over unchanged.

Done check: on dev: one project open → toggle shows the column beside the transcript; two stacked → column; three columns → toggle takes over the pane; the strip is absent from the DOM; the list shows ui13 and ui13r jobs in one sequence with no "Other runs" heading. Phone holds. Fresh-context subagent verification. Commit.

## Job 2 — Worker top bar restored and the dropdown really gone

Goal: the worker pane's top bar matches the planner's, the session-title dropdown is eliminated in favor of job-row navigation, and edge tooltips stay on screen. Files: WorkerPane header, the jobs row navigation, Tooltip primitive, DESIGN.md. Dependencies: job 1.

- [ ] Top bar left: the worker icon and the word "Worker" exactly like the planner pane's "Planner", followed by the active session's small title text in the planner's style (e.g. "Continuing previous work from handoff"). No dropdown on the title: clicking it does nothing; the previous-sessions dropdown is removed outright.
- [ ] Navigation between worker sessions is the job list: hovering a job row swaps its chevron for the chat icon, clicking it opens that job's session in the pane (ui13 specified this; verify it works end to end and fix whatever made Willem see a dropdown instead).
- [ ] Top bar right: a plus button for a new worker session sits immediately left of the Hide worker button, then the job sign toggle per job 1.
- [ ] Tooltips are collision-aware: near a screen edge the arrow stays anchored to the control and the box slides inward so no text is clipped; fix at the Tooltip primitive so every tooltip benefits.

Done check: on dev: header DOM shows icon + "Worker" + session title with no dropdown trigger; hovering a job row shows the chat icon and clicking navigates (URL/title change); the plus button creates a new worker session; the Hide worker tooltip at the right edge renders fully inside the viewport (rect check). Phone holds. Fresh-context subagent verification. Commit.

## Job 3 — Memory: one view, sized right, edited by prompt

Goal: Memory shows only Willem's curated memory, at a sane size, and he edits it by typing an instruction. Files: the memory surface, a small server route that runs a one-off edit session against planner/_global/WILLEM.md in the spoton-worker repo (commit and push), DESIGN.md. Dependencies: none.

- [ ] Remove the Internals tab and the Project/Global toggle; the surface is the curated memory only. Shrink the surface's controls to the app's normal control scale (the current buttons are far too large); the content reads as a clean document.
- [ ] A prompt box at the bottom, Claude.ai style: Willem types an edit instruction, a one-off headless session (not a chat, not an existing planner session) applies it to WILLEM.md following the file's own rules (add, update in place, rotate stale), commits and pushes the memory repo, and the view updates live with a small loading state then a check; repeatable for further edits; errors surface inline.
- [ ] Import hook: if `planner/_global/claude-ai-memory-export.md` exists in the spoton-worker repo (the planner files Willem's Claude.ai memory export there), a one-time import parses it into WILLEM.md keeping only what applies to how Willem works and his coding projects (drop unrelated personal facts), then renames the export to `.imported`; if the file is absent, skip and say so in the summary.

Done check: on dev: the surface shows only the document with normal-scale controls; an edit instruction ("remember that I prefer X") results in a WILLEM.md commit in the memory repo and the view updates without reload; the import runs if the export exists. Phone holds. Fresh-context subagent verification. Commit.

## Job 4 — Footer drawers exclusive, account switcher revamped

Goal: one footer drawer at a time, and an account switcher that looks like it belongs. Files: SidebarFooterDrawer, AccountsPanel, the add-account flow, DESIGN.md. Dependencies: none.

- [ ] Footer drawers are mutually exclusive: opening Settings, account, or Memory closes whichever was open, with the ramped transitions.
- [ ] Account switcher revamp, full design freedom, goal: looks good and matches the rest of the UI. Constraints: no top divider bar (use padding so it never overlaps the project list); account name shows in full, truncating with an ellipsis only on hover when the row's action buttons appear; the selection dot goes unless it earns its place; usage bars longer; left padding and overall spacing uncramped; keep the three-window usage readout and reset times.
- [ ] Add account replaces the API-key/setup-token form with the real flow: a short two-step sheet (log in with `claude /login` in a terminal, then `cswap add`) with a button that opens a shell window pre-filled with the login command and a second for `cswap add`, then the list refreshes when the new account appears.

Done check: on dev: opening Memory while account is open closes account (DOM); the switcher renders with full names at rest and ellipsis on hover; no API-key fields exist; the add flow opens the shell with the commands and the list refreshes after a stub `cswap add`. Phone holds. Fresh-context subagent verification. Commit.

## Job 5 — Settings navigation matches the app

Goal: settings stop looking like a foreign panel. Files: the settings surface, its tab strip, DESIGN.md. Dependencies: job 4.

- [ ] Remove the About tab. The remaining tabs use the same left-aligned icon-tab pattern as Projects/Chats/Archive (Appearance, Notifications, plus System if the former system settings still exist or were removed in the bloat sweep by mistake; restore them if so, state what happened).
- [ ] Reflow the settings content for the sidebar width without redesigning the controls: consistent section spacing, no oversized cards, same control scale as the rest of the app.

Done check: on dev: no About tab; the tab strip's DOM matches the sidebar icon-tab component; sections reflow without overflow at sidebar width and on phone. Fresh-context subagent verification. Commit.

## Job 6 — Pasted text is editable in its preview

Goal: opening a pasted-text preview lets Willem edit the text in place. Files: the PASTED chip preview, composer attachment state, DESIGN.md. Dependencies: none.

- [ ] The pasted-text preview becomes an editor: the text is editable in the preview, saves back to the attachment on close or Save, cancel restores; works for previews opened from the composer and from a sent bubble (sent bubbles stay read-only, state that).

Done check: on dev: edit text in a composer preview, close, send; the sent message carries the edited text; sent-bubble preview is read-only. Phone holds. Fresh-context subagent verification. Commit.

## Job 7 — Chain liveness and wake delivery (hardening)

Goal: a dead or wedged chain wakes someone; a dropped planner wake is never silent. Files: server/modules/watchdog (chain registry, wake queue), DESIGN.md untouched. Dependencies: none. Audit findings 1.3, 2.1, 2.3, 2.6.

- [ ] Chain liveness sweep: a running chain silent past a threshold gets its runner process and journal checked; a dead runner or a wedged phase flips the chain to stopped and wakes the planner (or fires decision-needed when no planner exists), never leaving a chain "running" forever.
- [ ] Wake-delivery fallback: a planner wake that drops or fails repeatedly fires a decision-needed fleet notification instead of silent discard; undelivered terminal wakes are re-derived on server hydrate.
- [ ] chrome-slot-wait gets a ceiling and a journal line instead of waiting forever.

Done check: on dev: a stub chain whose runner is killed flips to stopped and a wake lands within the threshold; a forced wake failure produces a decision-needed notification; server restart re-derives a pending terminal wake. Fresh-context subagent verification. Commit.

## Job 8 — Limits, check-offs, and task amendments (hardening)

Goal: account limits are handled with full information and job progress is live. Files: scripts/macos/dispatch-chain-runner, the cswap wiring, the watchdog punch-list reader, the append/manifest routes. Dependencies: none. Audit findings 2.5, 4.1, 6.3 plus the 2026-08-26 spend-limit lesson.

- [ ] Spend-cap awareness: when a phase exits on a monthly spend limit, the runner parks that account (marks it unavailable to cswap for the rest of the cycle, or the nearest cswap-supported equivalent) before switching, so recovery never bounces back to a capped account; cswap long-park escalation fires one decision-needed after K wait cycles.
- [ ] Live task check-offs: the watchdog watches each running chain's punch list file (fs watch with mtime debounce) and re-reads counts on change, so tasks tick off in the jobs view mid-job, not only at commit.
- [ ] Manifest task amendment: an announced job's task list can be amended before it starts (endpoint plus a `dispatch amend` subcommand), so a fold-in shows up in the jobs view; the planner's doctrine already assumes this.

Done check: on dev: a stub phase printing the spend-limit message parks the account and switches (journal shows it); editing a stub punch list ticks a task in the jobs view within seconds without a commit; `dispatch amend` adds a task to a queued job and the view shows it. Fresh-context subagent verification. Commit.

## Job 9 — Transcript scrub and promote guards (hardening)

Goal: leaked secrets stop living in local transcripts, and promote cannot tag a mid-flight commit. Files: a new local scrub script + launchd schedule, promote.sh, the handoff push path. Dependencies: none. Audit findings 3.5, 2.4, 2.8. Do not print any secret value anywhere while doing this.

- [ ] Transcript scrub daemon: a scheduled local job over ~/.claude/projects and ~/.claude-dev/projects that redacts known secret shapes (Twilio SK/secret pairs and AccountSids, Anthropic keys, generic bearer tokens) in place with a redaction marker, logs counts only, never values; first run covers the six transcripts the audit named (section 3.3), verified by grep count zero afterward.
- [ ] promote.sh guards the `mini-last-good` tag against a commit that belongs to a running chain (drain must be complete and HEAD must not be a dispatched phase mid-flight); handoff push failure fires decision-needed.

Done check: after the first scrub, grep for the audited shapes across both transcript dirs returns zero matches (counts in the summary, never values); promote's guard refuses a simulated mid-flight tag in a dry run; a forced handoff push failure notifies. Fresh-context subagent verification. Commit.

## Job 10 — Pipelined verification in the runner (hardening)

Goal: the round's biggest structural cost, the serial verify tail, overlaps with the next job's build. Files: scripts/macos/dispatch-chain-runner, watchdog chain events, the phase prompt contract. Dependencies: jobs 7-8. Audit 6.2-C. Blast radius medium; contained to the dispatch lane.

- [ ] Split each job into build (commit) and verify (fresh-context) stages: the runner starts job N+1's build as soon as job N's build commit lands, while job N's verify runs; a verify failure rewinds cleanly (stops the chain, records which commit failed verify, leaves N+1's work committed on a branch or stash, and wakes the planner with the exact resume point); journal and jobs view show both stages.
- [ ] Rehearse against a stub chain with a deliberately failing verify and with a clean run; measure the wall-clock saving on a 3-job stub versus serial and record it.

Done check: on dev: a stub 3-job chain runs with overlapping stages (journal timestamps prove overlap), a forced verify failure stops and rewinds with a resume point in the wake, and the clean run reports the measured saving. Fresh-context subagent verification. Commit.
