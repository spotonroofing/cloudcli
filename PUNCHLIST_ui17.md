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

- [x] Measure first on dev with a realistic state (cloudcli open, planner pane on a long real transcript, worker pane, jobs column with full history): heap size, DOM node count, detached DOM nodes, listener count and live intervals, taken at load, after 30 chat switches, after 10 minutes idle with a running worker streaming, and after opening and closing the jobs drawers and the memory sheet 20 times. Write the numbers down as the baseline in the summary.
- [x] Fix the top holders in order of measured size with a before-and-after number each: evict transcripts of sessions not in view beyond a small recent set (a bounded cache, re-fetch on return), keep only the paged window of a transcript mounted, dispose listeners, intervals and observers on unmount, hold images as URLs not blobs, and let the jobs history render its long tail cheaply. Budgets: heap after the whole scenario within 25 percent of the heap at load; DOM nodes bounded by the visible page of each list; zero detached nodes growing over the scenario; zero intervals left from unmounted components.
- [x] Add the memory scenario to the committed measurement script under `scripts/perf/` from Job 0 so both budgets run together, and record the numbers and rules in the performance section of `design/motion.md`.

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

## Job 5 — Durations on status rows, thought through (2026-08-28, Willem, widened). Verify: no

Goal: ui15 job 4 put every duration in a right-aligned meta slot, and it reads badly: the thinking indicator's counter floats at the far right edge away from its word, the "Thought for" row shows its seconds stranded on the right with a chevron, and tool rows do the same. Willem wants the whole family rethought so a duration sits where the eye already is. Files: `src/components/chat/view/subcomponents/ActivityIndicator.tsx`, the thinking, tool-call, agent, research, memory and watchdog row components (the indicator row family from ui15 job 14), `design/transcript-rows.md`; git history around 72e46a1 and ecff4e3 shows where the durations moved.

- [ ] One rule for every status row: the duration sits inline immediately after the row's label in the muted mono meta style ("Thought for 19.1s", "Bash 0.3s", the grid word then "47.7s"), a small fixed gap, same baseline; the right edge of a row holds only its expand chevron and nothing else. Live counters tick in that same inline slot.
- [ ] The thinking indicator (grid, word, counter) is a compact left-aligned group, never full-width justify-between.
- [ ] Tool rows keep their command preview after the label; the duration goes between the label and the preview ("Bash 0.3s  F=..."), and the preview truncates, never the duration; line-count details stay in the preview's muted style.
- [ ] Regression test on the family: each row type renders its duration within 12px of its label and no duration element sits in the row's trailing slot; `design/transcript-rows.md` documents the rule with one example per row type.

Done check: on dev during a running turn and on a loaded transcript with tool, thought, agent and memory rows, every duration's left edge sits within 12px of its label's right edge and the trailing slot contains only the chevron; tests pass; phone holds. Commit.

## Job 6 — File drop highlight holds steady while a file is over the pane (2026-08-28, Willem). Verify: no

Goal: dragging a file over a pane shows the dotted outline and wash (`data-slot="pane-drop-highlight"`, ui15 job 2), but it flickers in and out while the file is held over the pane. Files: the pane dropzone in `src/components/chat/view/ChatInterface.tsx` (`paneRef`, the dragenter/dragover/dragleave handlers), `design/composer.md`.

- [ ] Find the cause with evidence (almost always dragleave firing when the pointer crosses child elements, or dragover not calling preventDefault on every event) and fix it structurally: a depth counter or a single transparent overlay that owns the drag events while active, so the highlight stays on from the first dragenter until a drop or the pointer truly leaves the pane, with no flicker over children; the drop itself still works everywhere in the pane.
- [ ] The highlight's own transitions are ramped (motion law) and never re-trigger while active; both panes; phone unaffected.
- [ ] A regression test drives dragenter over the pane, dragover across three nested children, and asserts the highlight element stays mounted and opaque throughout; then dragleave outside the pane removes it.

Done check: on dev with agent-browser, synthetic drag events across the pane's children keep `pane-drop-highlight` present and at full opacity for the whole sequence; a drop still attaches the file; tests pass. Commit.

## Job 7 — Segmented ring breathing: opacity only, no blur (2026-08-28, Willem). Verify: no

Goal: the running job's segmented ring in the jobs column breathes with a blur that matches nothing else in the app. Keep the breathing, drop the blur: the active segment animates opacity alone (the stroke fading between its dim and full values on the ring's existing ramped curve), no filter, no glow, no scale. Files: the ring in `src/components/worker-pane/JobsSidebar.tsx` (or its ring component) and the keyframes it uses in `src/index.css`, `design/worker-pane-and-jobs.md`.

- [ ] The breathing keyframes animate `opacity` only; every `filter`, `blur`, `drop-shadow` or `box-shadow` step in that animation is removed; timing and ramp unchanged.
- [ ] Nothing else in the ring changes (segment geometry, colors, the check and the red X from Job 1).

Done check: on dev with the stub running job, the animated segment's computed style shows no filter at any sampled frame and its opacity moves between the two values; tests pass. Commit.

## Job 8 — Mobile navigation: one bottom taskbar, worker reachable, nothing clipped (2026-08-28, Willem). Verify: no

Goal: on a phone the app is hard to move around in. From a planner chat there is no way to reach the project's worker; tapping a worker from the footer activity drawer opens it under a header that still says "Planner" with the model switcher clipped off the right edge; the window selector (file tree, git panel, shell) does nothing on mobile. Willem asked for the simplest possible navigation and left the exact shape to the planner: the decision is a bottom taskbar, no header swap button (one mechanism, not two). Files: the mobile shell and top bar (`src/components/main-content/`, `src/components/app/`, the mobile top bar and its window selector), `WorkerPane.tsx`, `JobsSidebar.tsx`, the composer bottom row, `design/mobile.md`, `design/worker-pane-and-jobs.md`; the memory repo has a lesson with a Playwright WebKit iPhone recipe for checks.

- [ ] Bottom taskbar, phone viewports only: a fixed bar at the bottom of the screen above the safe area with wide equal-width segments splitting the width evenly: Planner and Worker always, plus one segment per tool window the user opened (Files, Git, Shell) so two segments read 50/50 and three read in thirds; tapping a segment shows that window full-screen; the active segment is marked in the app's monochrome language (ink shift, no color); labels only, no icons, so they stay readable at any count; the bar hides with a ramped slide the moment the composer takes focus (keyboard up) and returns when focus leaves, never leaving dead space above the keyboard.
- [ ] The window selector in the top bar opens tool windows as taskbar segments on mobile (or is hidden on mobile if the taskbar makes it redundant; pick one and say which in the summary); nothing in the top bar is a dead control.
- [ ] Worker on mobile: the Worker segment shows the project's worker session full-screen; its header says Worker (never Planner) and carries the jobs button; the jobs view opens as a full-screen takeover on mobile with a clear way back (the taskbar stays underneath it).
- [ ] Composer bottom row fits at 390px in both planner and worker: the model switcher label compacts (model name, effort as a short tag) and nothing is clipped or pushed off screen; the counter, history, switcher, usage and handoff controls all remain tappable.
- [ ] The footer activity drawer's session taps land in the right pane on mobile (a worker opens as the Worker segment, a planner as Planner).
- [ ] `design/mobile.md` documents the taskbar (segments, hide-on-focus, full-screen windows) and the mobile header rules.

Done check: with the WebKit iPhone recipe at 393x852: the taskbar shows Planner and Worker at equal width, opening the shell adds a third equal segment, tapping Worker renders the worker header and the jobs button, the jobs view fills the screen and closes back, focusing the composer hides the bar and blurring restores it, the bottom row's controls all lie inside the viewport; desktop unchanged (no taskbar above the phone breakpoint); tests for the segment math. Commit.

## Job 9 — Clearing the composer takes two taps (2026-08-28, Willem). Verify: no

Goal: the clear control (the one that wipes the text and the attachments; it sits with the character counter) fires on one tap and Willem has lost drafts to it. It needs a confirmation on both desktop and mobile. Files: `ChatComposer.tsx` and its clear/undo pieces (ui15 job 2), `design/composer.md`.

- [ ] First tap arms the control: it changes to a short "Tap again to clear" state in place (ramped swap, monochrome), stays armed for about 2 seconds or until the pointer leaves, and disarms on its own; the second tap within that window clears text and attachments. Keyboard: Escape disarms. The existing undo after a clear stays.
- [ ] Both panes, desktop and phone; `design/composer.md` documents the two-tap rule.

Done check: on dev, one click leaves the draft and attachments intact and shows the armed state; a second click within 2 seconds clears them and undo restores; waiting 3 seconds between clicks leaves the draft intact; tests pass; 390px holds. Commit.

## Job 10 — Download button moves into the top bar (2026-08-28, Willem). Verify: no

Goal: the floating download-chat button that hovers over the transcript (visible at the right edge on desktop and phone) goes away; the same action lives in the pane's top bar instead, as a bare icon. Files: the floating download control in the chat view (`src/components/chat/view/` and its subcomponents), the planner and worker pane top bars, `design/transcript-rows.md` or the area file that documents the pane top bar.

- [ ] The floating button is removed entirely (no overlay element left in the transcript on any viewport).
- [ ] The top bar of both the planner pane and the worker pane gains the download action as an icon-only button: the same icon, no background, no outline, no border; hover and press states follow the other top-bar icon buttons (window selector, shell), same size and spacing; same functionality and file output as before.
- [ ] Desktop and phone; the area file documents the top bar's control set.

Done check: on dev, no download control exists inside the transcript area on either pane; each pane's top bar has the download icon button with transparent background and no border in computed style; clicking it downloads the same file as before; 390px holds. Commit.

## Job 11 — Every job row looks the same (2026-08-28, Willem). Verify: no

Goal: appended units of kind "task" render as smaller, indented, lighter rows in the jobs column (see "Ring breathing, no blur" and "Download in the top bar" in the ui17 chain); Willem wants one row format for every job, whatever its kind or origin. Files: `src/components/worker-pane/JobsSidebar.tsx` and its row pieces, the chain record's unit kind (`server/modules/watchdog/`, the append path in `scripts/macos/dispatch` and the runner), `design/worker-pane-and-jobs.md`.

- [ ] The jobs column renders every unit with the same row anatomy, size, indent, ring and type treatment: no lighter or nested variant for "task" appends, no different ring, no smaller text; existing chains (ui17 included) render uniformly without any data migration, because the renderer ignores the kind.
- [ ] The `dispatch append` default kind becomes phase (the `--phase` flag stays accepted and is a no-op); the runner and watchdog keep accepting the stored "task" kind for old records; the dispatch header comment and the planner reference are updated by the planner, not this job (say so in the summary).
- [ ] The area file documents that units have one row style.

Done check: on dev with a stub chain that has one phase unit and one task-kind unit, both rows measure the same height, indent and font size and carry the same ring; `dispatch append` without `--phase` stores kind phase; tests pass. Commit.

## Job 12 — Fast mode shows as a bolt, not a word (2026-08-28, Willem). Verify: no

Goal: with fast mode on, the composer's model trigger shows a small muted `fast` text tag beside the model and effort; Willem wants a lightning bolt icon instead, nothing else changes. Files: the composer model trigger and menu (`src/components/chat/view/subcomponents/ComposerModelMenu.tsx` and the trigger it renders), `design/composer.md`.

- [ ] When fast mode is enabled the trigger shows a small lightning bolt icon (the app's icon set, same muted ink and size as the trigger's chevron) in place of the `fast` text; nothing renders when it is off; the switch row inside the menu keeps its label and cost line.
- [ ] Both panes, phone holds; `design/composer.md` updated.

Done check: on dev with fast mode on for a GPT-5.6 session the trigger contains the bolt icon and no `fast` text; off shows neither; 390px holds; tests pass. Commit.
