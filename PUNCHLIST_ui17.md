# PUNCHLIST_ui17 — performance for real, failed mark (2026-08-28, Willem's second pass)

## Goal

The app feels laggy everywhere on Willem's laptop (a machine with modest memory): switching chats is an instant jump with no visible selection-dot hop, the jobs column stutters, and the whole UI drags. ui16 job 2 touched only the jobs list and its performance check was never exercised; this round is an app-wide, evidence-first performance job with numeric budgets measured on a throttled machine, plus the failed-job mark he asked for on the old rows. Dev-first, promote without an eyeball gate.

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

## Job 0 — Performance, app-wide, with evidence and budgets. Verify: yes

Goal: find what actually makes the app lag on a modest laptop and fix the top causes, proving each with a before-and-after measurement. Files: wherever the evidence leads; likely suspects to measure first, not assume: the running-sessions and usage polls and how many components re-render per tick, websocket frame fan-out (does one frame re-render the whole tree, every pane, every sidebar row), transcript rows and markdown rendering without memoization, framer-motion `layout` animations on lists, backdrop blur and large box shadows on scrolling surfaces, the sidebar border beams and shimmers running while off screen, per-row timers and counters, refetching whole transcripts on chat switch, and heap growth from retained sessions and listeners. `design/motion.md`, `design/sidebar.md`, `design/transcript-rows.md`, `design/worker-pane-and-jobs.md` for anything documented.

- [x] Measure first, on dev, in a Chrome driven by agent-browser or a Playwright script with the CPU throttled 4x (Emulation.setCPUThrottlingRate) and a realistic state: the cloudcli project open with the planner pane on a long real transcript, the worker pane, and the jobs column with the full history. Record performance traces and React render counts for: 5 seconds idle; switching between two chats three times; a 5-second pointer sweep and wheel scroll over the jobs column; a 5-second sidebar scroll. Write the numbers down: long tasks over 50ms per scenario, total main-thread time, renders per component per scenario (React Profiler or a render-count hook), heap before and after 30 chat switches. This is the baseline; put it in the summary.
- [x] Fix the top causes in order of measured cost until the budgets hold, each fix with its own before-and-after number: no long task over 50ms during idle; chat switch to first paint of the new transcript under 150ms at 4x throttle; the jobs column sweep and the sidebar scroll produce no long task over 50ms; a websocket frame for one session re-renders only that session's consumers; polls re-render nothing when their data is unchanged; heap after 30 chat switches within 20 percent of the start; off-screen and hidden animations pause. Memoize, virtualize, split state, batch, or remove work; never hide a problem behind a debounce that delays what Willem sees.
- [x] The selection dot hop is visible: it moves between rows with a ramped spring of about 300ms on transform only (no layout animation), still smooth at 4x throttle, verified by sampling its transform mid-flight; the same for the bounce in the project chat list.
- [x] Every remaining animation on the screen keeps its ramp (motion law) but costs nothing while idle: shimmers, beams and pulses stop when the element is off screen or the tab is hidden, and no animation forces layout.
- [x] `design/motion.md` gains a performance section: the budgets above, how to measure them (the script from the first item, committed under `scripts/perf/` so the next round reruns it), and the rules (memoized rows, transform-only motion, no per-row timers, no layout reads in render).

Done check: the committed measurement script runs against dev at 4x CPU throttle and prints every budget with a pass; the summary carries the baseline and the after numbers side by side; regression tests for the render-scoping changes (a frame for session A does not render session B's rows); phone holds. Commit.

## Job 1 — Failed jobs wear the red segmented ring with an X. Verify: no

Goal: Willem wants to see the failed mark on the existing failed rows (Streaming off and tokens; Memory and status truth; Context diet) to judge it, and ui16 job 2 instead made those rows read as done. Files: `src/components/worker-pane/JobsSidebar.tsx` ring and mark pieces, `design/worker-pane-and-jobs.md`.

- [x] A job whose verify failed keeps its failed state in the column even when a later unit fixed it (drop the "read as done" from ui16 job 2; the "verify fixed in <unit>" line in its drawer stays and is the place that tells the story).
- [x] The failed mark is the same segmented ring as every other row, all segments red, with an X centered inside sized and stroked exactly like the done check (same box, same stroke width, same optical weight); no small red circle icon anywhere.
- [x] Applies to every historical row on live and dev, not only future jobs; the design area file documents the mark.

Done check: on dev with the stub chain fixture that has one job in each status, the failed row's ring is red on every segment with a centered X whose bounding box matches the check's on a done row within 1px; the three historical failed rows on live's data (or a copy on dev) render it; tests pass. Commit.

## Job 2 — Memory footprint of the tab (2026-08-28, Willem: it is memory, not CPU). Verify: yes

Goal: Willem's laptop sits at 64 percent memory idle with a quarter of it in the browser; the Command Center tab has to be a light tenant. Job 0 measured main-thread time; this job measures and cuts what the tab holds in memory. Files: wherever the evidence leads; suspects to measure, not assume: every session's transcript kept in memory after switching away, message arrays that only grow, listeners and intervals that survive unmount, duplicated composers and drafts per pane, image and attachment blobs retained, the jobs history holding every chain's full record, DOM node count on long transcripts, and any store that never evicts.

- [ ] Measure first on dev with a realistic state (cloudcli open, planner pane on a long real transcript, worker pane, jobs column with full history): heap size, DOM node count, detached DOM nodes, listener count and live intervals, taken at load, after 30 chat switches, after 10 minutes idle with a running worker streaming, and after opening and closing the jobs drawers and the memory sheet 20 times. Write the numbers down as the baseline in the summary.
- [ ] Fix the top holders in order of measured size with a before-and-after number each: evict transcripts of sessions not in view beyond a small recent set (a bounded cache, re-fetch on return), keep only the paged window of a transcript mounted, dispose listeners, intervals and observers on unmount, hold images as URLs not blobs, and let the jobs history render its long tail cheaply. Budgets: heap after the whole scenario within 25 percent of the heap at load; DOM nodes bounded by the visible page of each list; zero detached nodes growing over the scenario; zero intervals left from unmounted components.
- [ ] Add the memory scenario to the committed measurement script under `scripts/perf/` from Job 0 so both budgets run together, and record the numbers and rules in the performance section of `design/motion.md`.

Done check: the committed script runs the memory scenario against dev and prints each budget with a pass; the summary carries baseline and after numbers side by side; regression tests for the eviction and disposal changes. Commit.

## Job 3 — Sidebar footer: planner and worker activity as small monochrome icons (2026-08-28, Willem). Verify: no

Goal: the sidebar footer's activity drawer (the one that expands to show "Worker 1" and the planner) reads green and shows a stray double dash; Willem wants it monochrome and folded into the bottom bar. Files: the sidebar footer and its activity drawer component, the bottom bar holding settings, account switcher and memory, `design/sidebar.md`.

- [ ] The activity readout moves to the right side of the bottom bar beside settings, the account switcher and memory, as small icons in the app's monochrome (no green text or fills anywhere in it): the hammer icon with the worker count to its right, and the planner icon with the planner count to its right, stacked one above the other; when only one of the two is active the single line sits vertically centered; when both are active the stack sits centered; when none is active nothing renders there.
- [ ] The expanded drawer that lists the running planner and worker sessions keeps working from the new spot (click the stack to open it) and is monochrome too, same row anatomy as the rest of the sidebar.
- [ ] The stray double dash after "Worker 1" in the current drawer: find what value the dash stands for (a time, a model, a context figure that is not loaded yet) and either show the real value once it exists or render nothing, never a placeholder dash.
- [ ] Phone holds; `design/sidebar.md` documents the footer anatomy.

Done check: on dev with the stub fixture that has a planner and a worker running, the bottom bar's right group renders the two-line stack centered, one line when only one is active, nothing when idle; no element in the footer uses a green color token; no "--" text anywhere in the footer; clicking the stack opens the drawer; 390px holds. Commit.

## Job 4 — Account switcher: one look for both lists, the real Claude mark, no Add account (2026-08-28, Willem). Verify: no

Goal: the account switcher drawer got provider headers with logos, but the Claude header uses a different mark than the rest of the app, the ChatGPT rows carry a logo the Claude rows do not, and there is an Add account button that will never be used. Files: the account switcher drawer and its rows (`src/components/sidebar/` account switcher pieces), the provider mark component the model switcher uses, `design/sidebar.md`.

- [ ] The Claude header uses the same Claude mark the model switcher uses (the app's original one), rendered as a plain white monochrome glyph with no background disc, plate or tint behind it; the ChatGPT header mark gets the same treatment (plain monochrome glyph, no background) so the two headers match in size and weight.
- [ ] The Add account button is removed entirely (accounts are added by hand on the mini); nothing else in the drawer shifts to fill its place awkwardly, the sections just stack.
- [ ] The ChatGPT account list copies the Claude list's row anatomy exactly: a number on the left instead of a logo, the email, the plan tag where the Claude rows put theirs, the same meter rows (5H, 7D, and the model window where one exists), the same "updated" line; one shared row component for both providers so they cannot drift again.
- [ ] Phone holds; `design/sidebar.md` documents the drawer as one anatomy for both providers.

Done check: on dev with agent-browser, both provider headers render the same mark component with no background element behind the glyph; no "Add account" text exists in the drawer; the ChatGPT row is the same component as the Claude rows and starts with a number; 390px holds. Commit.

## Job 5 — Thinking indicator: the counter sits next to the word again (2026-08-28, Willem). Verify: no

Goal: the response-in-progress row (pixel grid, status word, elapsed counter) now puts the counter at the far right edge of the row, apparently matching the tool-call rows' right-aligned duration slot; that is a different element. The thinking indicator returns to its original layout: grid, word, and the counter directly to the right of the word in the same compact group. Only this indicator changes; tool rows, agent rows and every other status row keep their right-aligned duration. Files: `src/components/chat/view/subcomponents/ActivityIndicator.tsx` (and whatever wrapper or shared row class ui15 job 4's "exact durations on status rows" or job 14's "one anatomy for indicator rows" applied to it), `design/transcript-rows.md`; git history around 72e46a1 and ecff4e3 shows where it moved.

- [ ] The elapsed counter renders inline right after the status word (a small gap, same baseline, same mono muted style as before), not pushed to the row's right edge; the row is no longer full-width justify-between for this indicator.
- [ ] Nothing else moves: tool-call, agent, research, memory and watchdog rows keep their duration in the right-aligned meta slot; regression test asserting the indicator's counter is adjacent to the word (their bounding boxes within 12px) while a tool row's duration is right-aligned.
- [ ] `design/transcript-rows.md` notes the exception in one line.

Done check: on dev during a running turn, the activity indicator's counter left edge sits within 12px of the word's right edge while a tool row's duration stays at the row's right edge; tests pass; phone holds. Commit.
