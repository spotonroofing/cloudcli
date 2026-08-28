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

- [ ] Measure first, on dev, in a Chrome driven by agent-browser or a Playwright script with the CPU throttled 4x (Emulation.setCPUThrottlingRate) and a realistic state: the cloudcli project open with the planner pane on a long real transcript, the worker pane, and the jobs column with the full history. Record performance traces and React render counts for: 5 seconds idle; switching between two chats three times; a 5-second pointer sweep and wheel scroll over the jobs column; a 5-second sidebar scroll. Write the numbers down: long tasks over 50ms per scenario, total main-thread time, renders per component per scenario (React Profiler or a render-count hook), heap before and after 30 chat switches. This is the baseline; put it in the summary.
- [ ] Fix the top causes in order of measured cost until the budgets hold, each fix with its own before-and-after number: no long task over 50ms during idle; chat switch to first paint of the new transcript under 150ms at 4x throttle; the jobs column sweep and the sidebar scroll produce no long task over 50ms; a websocket frame for one session re-renders only that session's consumers; polls re-render nothing when their data is unchanged; heap after 30 chat switches within 20 percent of the start; off-screen and hidden animations pause. Memoize, virtualize, split state, batch, or remove work; never hide a problem behind a debounce that delays what Willem sees.
- [ ] The selection dot hop is visible: it moves between rows with a ramped spring of about 300ms on transform only (no layout animation), still smooth at 4x throttle, verified by sampling its transform mid-flight; the same for the bounce in the project chat list.
- [ ] Every remaining animation on the screen keeps its ramp (motion law) but costs nothing while idle: shimmers, beams and pulses stop when the element is off screen or the tab is hidden, and no animation forces layout.
- [ ] `design/motion.md` gains a performance section: the budgets above, how to measure them (the script from the first item, committed under `scripts/perf/` so the next round reruns it), and the rules (memoized rows, transform-only motion, no per-row timers, no layout reads in render).

Done check: the committed measurement script runs against dev at 4x CPU throttle and prints every budget with a pass; the summary carries the baseline and the after numbers side by side; regression tests for the render-scoping changes (a frame for session A does not render session B's rows); phone holds. Commit.

## Job 1 — Failed jobs wear the red segmented ring with an X. Verify: no

Goal: Willem wants to see the failed mark on the existing failed rows (Streaming off and tokens; Memory and status truth; Context diet) to judge it, and ui16 job 2 instead made those rows read as done. Files: `src/components/worker-pane/JobsSidebar.tsx` ring and mark pieces, `design/worker-pane-and-jobs.md`.

- [ ] A job whose verify failed keeps its failed state in the column even when a later unit fixed it (drop the "read as done" from ui16 job 2; the "verify fixed in <unit>" line in its drawer stays and is the place that tells the story).
- [ ] The failed mark is the same segmented ring as every other row, all segments red, with an X centered inside sized and stroked exactly like the done check (same box, same stroke width, same optical weight); no small red circle icon anywhere.
- [ ] Applies to every historical row on live and dev, not only future jobs; the design area file documents the mark.

Done check: on dev with the stub chain fixture that has one job in each status, the failed row's ring is red on every segment with a centered X whose bounding box matches the check's on a done row within 1px; the three historical failed rows on live's data (or a copy on dev) render it; tests pass. Commit.
