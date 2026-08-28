# PUNCHLIST_ui16 — Willem's fix round on the ui15 build (2026-08-28)

## Goal

Willem's first pass on live after the ui15 promote: the selection dot is gone, the composer's control row was built backwards, the jobs column is cluttered and clunky, and the wake-target bell reads as a notification. Three jobs by locality, dev-first, end-to-end verification, promote without an eyeball gate. Job 19 of PUNCHLIST_ui15 (runtime rename) runs alone after this chain.

## Stack and decisions already made

- Verifier scope per doctrine: each job below carries "Verify: yes" (fresh-context verifier) or "Verify: no" (UI-only, Willem's eye is the reviewer).
- Standing laws: personal-tool wording, drawers not popups, ramped motion, monochromatic with semantic status color, DESIGN.md consistency, mobile parity, no em dashes in UI copy, label caps, rebuild discipline, pathspec commits for any planner files.
- Tooltips stay banned except non-self-evident icon controls; the commit footer in a job drawer is sanctioned for one (tiny space, real need).

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to DESIGN.md.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Run rules (from ui15r2r, 2026-08-27): browser and UI checks use agent-browser against dev; Codex's computer-use tool is not installed on this machine (it needs an OpenAI helper called orca), never attempt it. Jobs run on Codex GPT-5.6 Sol with the runner's verify stage (Terra); do not spawn subagents and skip any "fresh-context subagent" wording in a done check, the runner's verify stage is that check. Items marked done in the codex round stay checked; do not redo them. On unrecoverable failure stop and state what blocks.
- Check each item off in this file the moment it is verified, in its own small commit or at least its own file write, never all at once at job end: the jobs column reads this file live and ticks tasks one by one from it (Willem, 2026-08-27 late).
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0 — Sidebar: the selection dot returns, the wake-target mark stops looking like a bell. Verify: no

Goal: Willem's favorite sidebar detail is gone and a new mark misleads him. Files: `src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx`, `ChatRow.tsx`, `ChatRowMenu.tsx`, `Sidebar.tsx`, `design/sidebar.md`; git history at 55ff266, ebd501d and ce56e1a.

- [x] The selection dot is back exactly as it was: the small beUI-derived dot on the left of the selected chat row that hops (ramped, spring-like) to whichever row is selected, in both the Chats tab and the project's chat list. Commit ce56e1a (streaming off, job tokens) removed it while removing the new-chat orange dot, which was a different component; restore the bounce dot from the pre-ce56e1a implementation (`bounceKey`, `data-bounce-key`, its motion) and keep the new-chat dot gone. Regression test that the dot exists on the selected row and moves on selection change.
- [x] The watchdog wake-target mark (the `BellRing` at `data-slot="watchdog-wake-target-mark"`, ui15 job 18) no longer renders as a bell in the row: it reads as a notification and Willem expected it to clear on visit. Replace it with a muted mono `wake` tag that shows only on row hover (and in the row menu, where the manual move already lives), never a bell glyph, same slot and row height; nothing about which session receives wakes changes. Document in `design/sidebar.md`.

Done check: on dev with agent-browser: selecting two different chats in turn shows one `[data-bounce-key]` dot on the selected row each time and its transform animates between them; no `watchdog-wake-target-mark` bell exists in the DOM at rest; hovering the wake-target row shows the tag; tests pass. Commit.

## Job 1 — Composer: the controls live under the prompt bar, not inside it. Verify: no

Goal: ui15 job 12 was compiled backwards and moved the context window control into the box; Willem wants the opposite. The prompt bar is the box where his text lives; the controls sit in a row below it, outside the box. Files: `src/components/chat/view/subcomponents/ChatComposer.tsx` and its controls row pieces, `TokenUsageSummary` trigger, `design/composer.md`.

- [ ] Below the prompt bar, outside its border, one full-width row: bottom-left the character counter (the count of characters typed), aligned with the box's left edge; bottom-right, reading right to left: the usage indicator (the context window control), the model switcher, the prompt history button, the handoff button. Same heights and icon language as today.
- [ ] Inside the box only what the text needs: the plus (attachments) on the left, the send/stop button on the right, the voice button where it is today; clear/undo stays with the plus. Nothing else inside the box.
- [ ] Both panes, phone holds (the row wraps or compacts at 390px without hiding any control); `design/composer.md` rewritten to match, replacing the ui15 job 12 note.

Done check: on dev: the DOM order of the row below the composer enclosure is counter, then (right group left to right) handoff, history, switcher, usage; the enclosure contains plus, clear/undo, voice, textarea, send and nothing else; 390px shows every control. Commit.

## Job 2 — Jobs column: quieter rows, truthful failures, solid feel. Verify: yes

Goal: the column shows too much per row, marks fixed jobs as failed, opens chats on clicks that were meant to expand, and stutters on hover and scroll. Files: `src/components/worker-pane/JobsSidebar.tsx`, `WorkerPane.tsx`, `workerRunFollow.ts`, the watchdog chain records (supersedes headers, `supersededBy`), `design/worker-pane-and-jobs.md`.

- [ ] Collapsed rows show the ring, the name, and the chevron only: the token figure leaves the row (it stays in the drawer, bottom, next to the total time) and the `N/N` task counter leaves the row (the segmented ring already carries progress); the name gets the freed width.
- [ ] Marks: the done check mark shrinks (about two thirds of today's); a failed job shows the whole segmented ring in red with an X in the middle, the same footprint and stroke as the check; both centered in the ring slot.
- [ ] Failure truth: a job whose build committed and whose verify failure was fixed by a superseding unit (Context diet fixed by ui15r4 unit 1, Memory and status truth by ui15r5 unit 1, Streaming off and tokens by ui15r6 unit 1) reads as done, with a one-line "verify fixed in <unit name>" note in its drawer; the red ring is only for a job whose work never landed. Derive it from the supersedes headers already stored; no hand list.
- [ ] Clicks: clicking a job name or its row body toggles the drawer and nothing else; only the explicit session control (the row's open-chat affordance) navigates the pane; find why a name click sometimes opens the chat (a lesson in the memory repo covers split-action rows) and fix the hit areas.
- [ ] Feel: hovering and scrolling the list stays smooth; the hover marquee on task labels runs on transform only, starts after a short delay, and stops the instant the pointer leaves (no label keeps scrolling); no per-row intervals or timers while idle; no layout reads in render; if the list is long, rows outside the viewport render cheaply. Measure with the browser's performance tooling: no long task over 50ms while sweeping the pointer down the list or wheel-scrolling it.

Done check: on dev with the stub chain fixture that has one job in each status: collapsed rows contain no token figure and no counter; the check and the red X ring measure the same box; a superseded failed job renders the check and its drawer carries the fixed-in note; a name click toggles the drawer without changing the pane's session id; a recorded performance trace over a 5-second pointer sweep plus wheel scroll has no long task over 50ms; regression tests. Commit.

## Job 3 — Memory rows land in the chat that wrote them (2026-08-28, Willem, second report). Verify: yes

Goal: when a worker writes a lesson or a session summary, the "Memory updated" row still shows up in the planner's chat; Willem wants it in the worker's chat, and a planner write in the planner's chat, always. Files: the memory watcher and its attribution (`server/modules/memory/memory.service.ts` and whatever maps a file write to a session), the sessions watcher for Claude JSONL and Codex rollouts, the memory-updated row renderer, `design/transcript-rows.md`.

- [ ] Find the cause with evidence and fix it at the source: a lesson in the memory repo records that workers write memory files with shell heredocs and appends (Bash tool calls in Claude, shell commands in Codex rollouts), so an attribution that only scans file-tool calls misses every worker write and falls back to the planner. Attribution keys on the session whose tool call or shell command actually touched the file path (Claude Bash and Write/Edit alike; Codex `command` items in the rollout alike), matched by path and time within the watcher's window.
- [ ] Never a planner fallback: when no session can be tied to a write, the row goes to the dispatched or direct worker session running in that project at that moment if there is exactly one, otherwise it renders nowhere and logs one line; the planner receives a memory row only for its own writes.
- [ ] Both engines covered by regression tests: a Codex worker heredoc write, a Claude worker Bash append, and a planner Write-tool edit each land in their own session; live and on reload.

Done check: on dev, a stub Codex worker session (a `codex exec` one-liner in `~/Projects/codex-smoke` that appends a line to a lesson file under the memory repo's planner folder) produces the memory row in that worker session's transcript and nothing in the planner's; the same with a Claude one-off; tests pass. Commit.
