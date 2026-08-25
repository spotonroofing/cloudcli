# PUNCHLIST_ui12 — queued-message truth, composer polish, scroll truth, jobs sidebar, semantic status, memory surface

## Goal

Willem's post-promote round on the ui11 build. Queued messages become impossible to double-send from a stale device, the prompt bar gets its sizing and alignment right, the transcript scrollbar tells the truth, the phase navigator becomes a right-hand jobs sidebar with real history, status icons get semantic color, and the planner's memory writes become visible in the app. Dev-first, end-to-end verification, then promote without an eyeball gate (revised self-surgery rule); Willem reviews live.

## Stack and decisions already made

- Self-surgery, dev-first: build and verify on dev (4748) with dev artifacts; never touch live's dist/ or run promote from a phase. Dev restart: `launchctl kickstart -k gui/$(id -u)/com.spoton.cloudcli-dev`, then `curl http://127.0.0.1:4748/health`.
- "Phase" renames to "Job" in all user-facing copy (Willem approved renaming; Job is the planner's pick, a one-line swap later if he prefers another word). Tasks stay tasks. Internal identifiers, API routes, and DB columns keep their names; this is UI copy only.
- Standing law revised (2026-08-25): monochromatic iconography except semantic status — done is green, working is the accent, idle stays muted. Colors carry meaning only.
- The Claude Code desktop composer screenshot is a sizing and placement reference only; Command Center keeps its own components and look.
- Standing laws: drawers/sheets not centered popups; mobile parity tap-first; DESIGN.md consistency; no em dashes in UI copy.

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to DESIGN.md. Match colors, spacing, fonts, corners, shadows.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each phase, push at phase end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Keep each phase under 5 concurrent subagents. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Phase 1 — Queued messages cannot ghost-send

Goal: a queued message can never fire from a stale device. Willem queued a message on his home computer, shut it down, and when he powered it back on the old tab flushed and sent it. The server-side queue from ui11 phase 1 is the sole truth; no client-local remnant may ever auto-send. Files: src/components/chat/utils/chatStorage.ts and the queue paths in useChatComposerState, the server queued-messages store and routes, WebSocketContext reconnect handling. Dependencies: none.

- [ ] Find every path where a client-local (localStorage or in-memory) queued message can still reach send: boot flush of pre-ui11 localStorage keys, reconnect replay, visibility-change flush, anything else the sweep finds. Remove the legacy flush entirely: on boot a client purges pre-ui11 local queue keys without sending them, and reconciles only against the server queue.
- [ ] A queued message consumed on one device (sent, edited, cleared, or steered into a turn) is authoritative on the server; every other device applies the change live and a device coming back online adopts server state, never pushes its stale copy.
- [ ] Walk the full lifecycle matrix and fix what fails: queue then close tab, queue then shut down and return, queue on A edit on B, queue while a turn runs then reconnect mid-turn, queue then session switch. List each case and its result in the summary.

Done check: on dev with two agent-browser profiles: plant a fake pre-ui11 localStorage queued message in profile A, reload; it does not send and the key is purged. Queue on A, kill A's browser, consume on B, relaunch A; A shows server state and sends nothing. Fresh-context subagent verification. Commit.

## Phase 2 — Prompt bar sizing, padding, and alignment

Goal: the prompt bar reads slightly smaller and properly padded, its floating row lines up flush with the enclosure edges, and attachments carry the promised border without the click-flash. Sizing and placement reference is the Claude Code desktop composer (model selector low in the corner, controls aligned to the box edges); keep Command Center's own look and components. Files: ChatComposer.tsx and its attachment previews, the secondary-row components, DESIGN.md. Dependencies: none.

- [ ] Compact pass: reduce the composer's overall scale a step (text, control heights, paddings proportionally); restore the missing bottom padding so the send button and text no longer touch the enclosure's bottom edge.
- [ ] The floating row under the enclosure aligns flush: the left control cluster's left edge to the enclosure's left border, the usage ring's right edge to the enclosure's right border. The model selector moves down into that row (Claude Code desktop placement), keeping the existing selector component.
- [ ] Attachment previews (images, files, pasted text) carry the enclosure's border style as ui11 specified; images fit-contained. The 2-3px stroke that flashes when clicking a preview open (a focus/active artifact) is found and removed; opening a preview is visually clean.

Done check: on dev, DOM measurements: bottom padding present between send button and border; left cluster and usage ring flush with the enclosure edges within 1px; thumbnails carry the border classes; clicking a preview produces no transient outline (assert no outline/ring style on active). Phone viewport holds. Fresh-context subagent verification. Commit.

## Phase 3 — The scrollbar tells the truth

Goal: the transcript scrollbar spans the full pane, and the bottom of the scroll is the real bottom. Today the scrollbar's track stops at the top of the prompt bar and over-scroll lands in whitespace. Known constraints: Chrome ignores ::-webkit-scrollbar when scrollbar-width is set (lesson scrollbar-width-disables-webkit-scrollbar-css: use layout tricks, webkit width edits do nothing) and scroll geometry must stay honest (lesson content-visibility-breaks-scroll-truth: do not reintroduce content-visibility). Files: the transcript scroll container in ChatMessagesPane/ChatInterface, layout CSS. Dependencies: phase 2 (composer height settles first).

- [ ] The scroll container (and its scrollbar track) extends from the top of the pane to the bottom of the viewport, the composer floating above it, so the thumb's travel covers the full pane height like the top already does.
- [ ] Scrolled fully down means the last message sits just above the composer: no whitespace run-out below the content, and the bottom-anchor logic agrees with the visual bottom.

Done check: on dev via agent-browser: the scroll container's bounding box reaches the viewport bottom; scrollHeight minus clientHeight equals the scrollTop at which the last message row is fully visible with no empty band below it; desktop and phone. Fresh-context subagent verification. Commit.

## Phase 4 — Semantic status colors and per-job task counters

Goal: status carries color even in a monochromatic theme, and every job row shows its own counter. Files: the navigator/job row components, status icon components, theme tokens, DESIGN.md; the counter data path from ui11 phase 6/10 if it is not rendering. Dependencies: none.

- [ ] Status icons get semantic colors from new theme tokens: done checks are green, the working indicator uses the accent, idle stays muted ink; applies to task rows, job rows, and the top-bar counter (green when complete, like "5/5"). Document the semantic-color exception to the monochromatic law in DESIGN.md.
- [ ] Every job row shows its own done/total task counter on the right (the top bar already does); find why per-job counters did not render for the ui11r run (manifest tasks present but counters absent on Willem's screen) and fix the path so counters appear for any chain with a manifest, including appended jobs.

Done check: on dev with a stub chain: task check icons computed-style green, working icon accent, idle muted; each job row shows n/N on the right, green at completion; ui11r's stored record renders counters in the history view. Phone viewport holds. Fresh-context subagent verification. Commit.

## Phase 5 — Jobs sidebar replaces the top-of-pane navigator

Goal: jobs move out of the worker pane's top strip into a right-hand sidebar sized like the left sidebar: a full scrollable history, newest at the top, progressing bottom-to-top, with tasks nested under each job. Files: the worker pane layout, the navigator components (relocated), watchdog history endpoints as needed, DESIGN.md. Dependencies: phase 4 (colors and counters land first).

- [ ] A right sidebar (same width treatment as the left one, collapsible the same way) hosts the job list for the selected run: every job as a drawer row with its tasks, counters, and status icons; the top strip in the worker pane is removed.
- [ ] Order is bottom-to-top: job 1 sits at the bottom, later jobs stack upward, the newest (or queued) at the top; appended jobs push the stack down as they arrive. Completed runs keep their full job and task history scrollable in the same sidebar so Willem can review what each job completed.
- [ ] All user-facing copy says Job (Job 5 of 5, appended job, job counters); wake and notification copy that renders in the UI follows; internal names stay.

Done check: on dev with a stub chain and the ui11r history: the sidebar renders on the right at the left sidebar's width, jobs ordered oldest-at-bottom, tasks expand per job, history scrolls for a completed run, no top-strip navigator remains, and the word "phase" is absent from the worker pane UI copy (DOM text sweep). Phone: the jobs sidebar becomes a full-width sheet consistent with the app's sheet law. Fresh-context subagent verification. Commit.

## Phase 6 — Selection dot vanishes with the drawer

Goal: the bouncing selection dot never lingers over other rows when its project collapses. Today it fades in place and overlaps the rows that slide up. Files: the BounceIndicator and sidebar collapse animation. Dependencies: none.

- [ ] Collapsing a project (or anything that removes the dot's target row) hides the dot in sync with the collapse animation: it either rides the row out or disappears within the collapse duration, never floating over unrelated rows; reopening seats it correctly again.

Done check: on dev via agent-browser with reduced-motion off: during collapse, at animation midpoint the dot is not visible over any other project's row (opacity/position assertions per lesson dev-nested-row-fixture-and-hidden-bounce-dot); after reopen the dot seats at the active row. Fresh-context subagent verification. Commit.

## Phase 7 — Memory writes are visible and manageable

Goal: when the planner logs memory, Willem sees it, and memory is browsable. Files: server watch on the memory repo paths, a transcript indicator component, a memory viewer surface, the /planner boot flow for the global folder, DESIGN.md. Dependencies: none.

- [ ] When a planner session writes into planner memory (the spoton-worker repo: STATE.md, PROJECT.md, lessons/, sessions/) or native auto-memory, the transcript shows a small memory-updated indicator row naming the file (grouped when several land in one turn), rendered live and on reload. Detection watches the memory paths server-side; no reliance on the model announcing itself.
- [ ] A read-only memory viewer (a drawer or panel consistent with the app's patterns) lists the current project's PROJECT.md, STATE.md, lessons (one-line summaries, expandable), and recent session summaries, plus a Global tab reading planner/_global/.
- [ ] Create `planner/_global/` in the spoton-worker repo with a seed README describing its contract (cross-project preferences and lessons; the planner reads it at boot alongside project memory); the viewer reads it. Keep CLAUDE.md files out of scope; nothing new writes to them.

Done check: on dev, a planner-session test write of a lesson file produces the indicator row in that session's transcript live and after reload; the viewer lists PROJECT.md/STATE.md/lessons and opens content; the Global tab shows the seed file. Fresh-context subagent verification. Commit.

## Job 8 — Job rings and task spinners actually animate (appended 2026-08-25)

Goal: the worker sidebar's status icons live and breathe. Today the task loading icons sit static. Willem confirmed the word Job. Files: the job/task status icon components from phase 4, the app's existing ramped spinner element, theme motion tokens, DESIGN.md. Dependencies: phase 4 (semantic colors land first).

- [ ] The working task's icon is the app's existing partial-circle spinner with its eased, ramped rotation (find and reuse it; do not roll a new one), and the working task row breathes: a subtle opacity/scale pulse, transform and opacity only, honoring prefers-reduced-motion.
- [ ] The active job's indicator breathes the same way, and its progress ring is a static partial circle segmented by task count (three tasks, three arc segments with small gaps): each completed task fills its segment (green per phase 4); when the last task completes, a full-circle sweep animation runs and the checkmark animates in.
- [ ] Jobs with no manifest tasks keep a plain spinner while running and the same sweep-to-check on completion.

Done check: on dev with a stub chain of a 3-task job: the working task icon's computed animation is running (non-none, rotating), the job ring shows 3 segments with the completed count filled after check-offs, the completion sweep and check-in animation fire at job end, and with prefers-reduced-motion emulated the pulses and sweep reduce to state changes. Phone viewport holds. Fresh-context subagent verification. Commit.

## Job 9 — Lining numerals everywhere, and the thinking counter reads right (appended 2026-08-25)

Goal: digits sit on one line, everywhere, for real this time, and the thinking duration is formatted like beautifului's. The composer's character counter shows 5 and 8 riding higher than 1: the font is rendering oldstyle (text) figures, whose digits have ascenders and descenders by design; ui11 phase 9 centered the boxes but did not force lining figures. Files: the shared number/mono style from ui11 phase 9, global font-feature CSS, the thinking/turning duration component, DESIGN.md. Dependencies: none.

- [ ] Force lining figures app-wide for numeric UI: `font-variant-numeric: lining-nums` (plus `tabular-nums` where columns align: counters, timers, token counts) on the shared number style, and verify the loaded font honors it (computed style plus a rendered-glyph bounding check); if the font family itself lacks lining figures in the weight used, swap the numeric style to a weight or family that has them. Sweep the app for digit sites not on the shared style (the composer character counter is one) and put them on it.
- [ ] Thinking/turning duration format: consult beautifului's transcript components in the GitHub mirror TurboKach/ai-native-react-components (beautifului.dev itself is unreachable from this network, see the lesson) for their duration convention; adopt it exactly (unit spacing like "1m 50s" versus "1m50s", casing, tabular digits). If the mirror shows no duration component, use "1m 50s" with a thin space and note that in the summary. The counter's digits sit on the text baseline per the lining fix.

Done check: on dev, DOM glyph-box measurements on the composer character counter and the thinking timer: all digits share top and bottom bounds within 1px; computed font-variant-numeric shows lining-nums; the duration renders in the adopted format with the space decision recorded in the summary. Phone viewport holds. Fresh-context subagent verification. Commit.

