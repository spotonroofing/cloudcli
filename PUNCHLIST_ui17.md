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

- [x] (ui17 verify finding, 2026-08-28) The full memory scenario still grows the heap 25.5 percent against the 25 percent budget after 1824317; find the remaining retained holder from the stage-by-stage numbers the script already records (the streaming stage was the suspect) and cut it, so the committed script's memory scenario passes with margin (target under 20 percent). Done check for this item: the script prints the memory budget as a pass twice in a row.

Done check: the committed script runs the memory scenario against dev and prints each budget with a pass; the summary carries baseline and after numbers side by side; regression tests for the eviction and disposal changes. Commit.

## Job 3 — Sidebar footer: planner and worker activity as small monochrome icons (2026-08-28, Willem). Verify: no

Goal: the sidebar footer's activity drawer (the one that expands to show "Worker 1" and the planner) reads green and shows a stray double dash; Willem wants it monochrome and folded into the bottom bar. Files: the sidebar footer and its activity drawer component, the bottom bar holding settings, account switcher and memory, `design/sidebar.md`.

- [x] The activity readout moves to the right side of the bottom bar beside settings, the account switcher and memory, as small icons in the app's monochrome (no green text or fills anywhere in it): the hammer icon with the worker count to its right, and the planner icon with the planner count to its right, stacked one above the other; when only one of the two is active the single line sits vertically centered; when both are active the stack sits centered; when none is active nothing renders there.
- [x] The expanded drawer that lists the running planner and worker sessions keeps working from the new spot (click the stack to open it) and is monochrome too, same row anatomy as the rest of the sidebar.
- [x] The stray double dash after "Worker 1" in the current drawer: find what value the dash stands for (a time, a model, a context figure that is not loaded yet) and either show the real value once it exists or render nothing, never a placeholder dash.
- [x] Phone holds; `design/sidebar.md` documents the footer anatomy.

Done check: on dev with the stub fixture that has a planner and a worker running, the bottom bar's right group renders the two-line stack centered, one line when only one is active, nothing when idle; no element in the footer uses a green color token; no "--" text anywhere in the footer; clicking the stack opens the drawer; 390px holds. Commit.

## Job 4 — Account switcher: one look for both lists, the real Claude mark, no Add account (2026-08-28, Willem). Verify: no

Goal: the account switcher drawer got provider headers with logos, but the Claude header uses a different mark than the rest of the app, the ChatGPT rows carry a logo the Claude rows do not, and there is an Add account button that will never be used. Files: the account switcher drawer and its rows (`src/components/sidebar/` account switcher pieces), the provider mark component the model switcher uses, `design/sidebar.md`.

- [x] The Claude header uses the same Claude mark the model switcher uses (the app's original one), rendered as a plain white monochrome glyph with no background disc, plate or tint behind it; the ChatGPT header mark gets the same treatment (plain monochrome glyph, no background) so the two headers match in size and weight.
- [x] The Add account button is removed entirely (accounts are added by hand on the mini); nothing else in the drawer shifts to fill its place awkwardly, the sections just stack.
- [x] The ChatGPT account list copies the Claude list's row anatomy exactly: a number on the left instead of a logo, the email, the plan tag where the Claude rows put theirs, the same meter rows (5H, 7D, and the model window where one exists), the same "updated" line; one shared row component for both providers so they cannot drift again.
- [x] On the phone the drawer closes on a tap anywhere above it (the sidebar area outside the drawer), the same way the other footer drawers dismiss; today it cannot be closed that way (added 2026-08-28 7:45 pm, Willem). `SidebarFooter.tsx` mounts `AccountsPanel` with `dismissOnOutside={false}`; find why that was set, keep desktop behavior as it is if the reason still holds there, and make the phone dismiss on an outside tap; a tap inside the drawer never closes it.
- [x] On the phone the rows are squished horizontally today: the email column gets enough room to show at least its first eight characters before any truncation, the meters and plan tag compact or wrap under it rather than crushing it, and nothing overflows the drawer at 390px (added 2026-08-29 12:15 am, Willem).
- [x] Phone holds; `design/sidebar.md` documents the drawer as one anatomy for both providers and the outside-tap dismiss on the phone.

Done check: on dev with agent-browser, both provider headers render the same mark component with no background element behind the glyph; no "Add account" text exists in the drawer; the ChatGPT row is the same component as the Claude rows and starts with a number; at 390px every account row shows at least eight characters of its email unclipped and the drawer has no horizontal overflow; opening the drawer then dispatching a tap on the sidebar above it closes the drawer (aria-expanded false on the trigger), and a tap inside it leaves it open. Commit.

## Job 5 — Durations on status rows, thought through (2026-08-28, Willem, widened). Verify: no

Goal: ui15 job 4 put every duration in a right-aligned meta slot, and it reads badly: the thinking indicator's counter floats at the far right edge away from its word, the "Thought for" row shows its seconds stranded on the right with a chevron, and tool rows do the same. Willem wants the whole family rethought so a duration sits where the eye already is. Files: `src/components/chat/view/subcomponents/ActivityIndicator.tsx`, the thinking, tool-call, agent, research, memory and watchdog row components (the indicator row family from ui15 job 14), `design/transcript-rows.md`; git history around 72e46a1 and ecff4e3 shows where the durations moved.

- [x] One rule for every status row: the duration sits inline immediately after the row's label in the muted mono meta style ("Thought for 19.1s", "Bash 0.3s", the grid word then "47.7s"), a small fixed gap, same baseline; the right edge of a row holds only its expand chevron and nothing else. Live counters tick in that same inline slot.
- [x] The thinking indicator (grid, word, counter) is a compact left-aligned group, never full-width justify-between.
- [x] Tool rows keep their command preview after the label; the duration goes between the label and the preview ("Bash 0.3s  F=..."), and the preview truncates, never the duration; line-count details stay in the preview's muted style.
- [x] Regression test on the family: each row type renders its duration within 12px of its label and no duration element sits in the row's trailing slot; `design/transcript-rows.md` documents the rule with one example per row type.

Done check: on dev during a running turn and on a loaded transcript with tool, thought, agent and memory rows, every duration's left edge sits within 12px of its label's right edge and the trailing slot contains only the chevron; tests pass; phone holds. Commit.

## Job 6 — File drop highlight holds steady while a file is over the pane (2026-08-28, Willem). Verify: no

Goal: dragging a file over a pane shows the dotted outline and wash (`data-slot="pane-drop-highlight"`, ui15 job 2), but it flickers in and out while the file is held over the pane. Files: the pane dropzone in `src/components/chat/view/ChatInterface.tsx` (`paneRef`, the dragenter/dragover/dragleave handlers), `design/composer.md`.

- [x] Find the cause with evidence (almost always dragleave firing when the pointer crosses child elements, or dragover not calling preventDefault on every event) and fix it structurally: a depth counter or a single transparent overlay that owns the drag events while active, so the highlight stays on from the first dragenter until a drop or the pointer truly leaves the pane, with no flicker over children; the drop itself still works everywhere in the pane.
- [x] The highlight's own transitions are ramped (motion law) and never re-trigger while active; both panes; phone unaffected.
- [x] A regression test drives dragenter over the pane, dragover across three nested children, and asserts the highlight element stays mounted and opaque throughout; then dragleave outside the pane removes it.

Done check: on dev with agent-browser, synthetic drag events across the pane's children keep `pane-drop-highlight` present and at full opacity for the whole sequence; a drop still attaches the file; tests pass. Commit.

## Job 7 — Segmented ring breathing: opacity only, no blur (2026-08-28, Willem). Verify: no

Goal: the running job's segmented ring in the jobs column breathes with a blur that matches nothing else in the app. Keep the breathing, drop the blur: the active segment animates opacity alone (the stroke fading between its dim and full values on the ring's existing ramped curve), no filter, no glow, no scale. Files: the ring in `src/components/worker-pane/JobsSidebar.tsx` (or its ring component) and the keyframes it uses in `src/index.css`, `design/worker-pane-and-jobs.md`.

- [x] The breathing keyframes animate `opacity` only; every `filter`, `blur`, `drop-shadow` or `box-shadow` step in that animation is removed; timing and ramp unchanged.
- [x] Nothing else in the ring changes (segment geometry, colors, the check and the red X from Job 1).

Done check: on dev with the stub running job, the animated segment's computed style shows no filter at any sampled frame and its opacity moves between the two values; tests pass. Commit.

## Job 8 — Mobile navigation: one bottom taskbar, worker reachable, nothing clipped (2026-08-28, Willem). Verify: no

Goal: on a phone the app is hard to move around in. From a planner chat there is no way to reach the project's worker; tapping a worker from the footer activity drawer opens it under a header that still says "Planner" with the model switcher clipped off the right edge; the window selector (file tree, git panel, shell) does nothing on mobile. Willem asked for the simplest possible navigation and left the exact shape to the planner: the decision is a bottom taskbar, no header swap button (one mechanism, not two). Files: the mobile shell and top bar (`src/components/main-content/`, `src/components/app/`, the mobile top bar and its window selector), `WorkerPane.tsx`, `JobsSidebar.tsx`, the composer bottom row, `design/mobile.md`, `design/worker-pane-and-jobs.md`; the memory repo has a lesson with a Playwright WebKit iPhone recipe for checks.

- [x] Bottom taskbar, phone viewports only: a fixed bar at the bottom of the screen above the safe area with wide equal-width segments splitting the width evenly: Planner and Worker always, plus one segment per tool window the user opened (Files, Git, Shell) so two segments read 50/50 and three read in thirds; tapping a segment shows that window full-screen; the active segment is marked in the app's monochrome language (ink shift, no color); labels only, no icons, so they stay readable at any count; the bar hides with a ramped slide the moment the composer takes focus (keyboard up) and returns when focus leaves, never leaving dead space above the keyboard.
- [x] The window selector in the top bar opens tool windows as taskbar segments on mobile (or is hidden on mobile if the taskbar makes it redundant; pick one and say which in the summary); nothing in the top bar is a dead control.
- [x] Worker on mobile: the Worker segment shows the project's worker session full-screen; its header says Worker (never Planner) and carries the jobs button; the jobs view opens as a full-screen takeover on mobile with a clear way back (the taskbar stays underneath it).
- [x] Composer bottom row fits at 390px in both planner and worker: the model switcher label compacts (model name, effort as a short tag) and nothing is clipped or pushed off screen; the counter, history, switcher, usage and handoff controls all remain tappable.
- [x] The footer activity drawer's session taps land in the right pane on mobile (a worker opens as the Worker segment, a planner as Planner).
- [x] `design/mobile.md` documents the taskbar (segments, hide-on-focus, full-screen windows) and the mobile header rules.

Done check: with the WebKit iPhone recipe at 393x852: the taskbar shows Planner and Worker at equal width, opening the shell adds a third equal segment, tapping Worker renders the worker header and the jobs button, the jobs view fills the screen and closes back, focusing the composer hides the bar and blurring restores it, the bottom row's controls all lie inside the viewport; desktop unchanged (no taskbar above the phone breakpoint); tests for the segment math. Commit.

## Job 9 — Clearing the composer takes two taps (2026-08-28, Willem). Verify: no

Goal: the clear control (the one that wipes the text and the attachments; it sits with the character counter) fires on one tap and Willem has lost drafts to it. It needs a confirmation on both desktop and mobile. Files: `ChatComposer.tsx` and its clear/undo pieces (ui15 job 2), `design/composer.md`.

- [x] First tap arms the control: it changes to a short "Tap again to clear" state in place (ramped swap, monochrome), stays armed for about 2 seconds or until the pointer leaves, and disarms on its own; the second tap within that window clears text and attachments. Keyboard: Escape disarms. The existing undo after a clear stays.
- [x] The clear control goes back to where it lived before ui16 Job 1: revealed on hover over the character counter (on the phone, a tap on the counter reveals it), not a standing button inside the prompt enclosure; the undo after a clear stays exactly as it is; the reveal, the armed swap and the undo keep the same ramped motion (added 2026-08-29 12:15 am, Willem: it was added to the prompt bar instead of staying at the counter). Read git history for the pre-ui16 placement (ui15 job 2) and restore that anatomy rather than inventing a new one; `design/composer.md` updates its ui16 job 1 line to match.
- [x] Both panes, desktop and phone; `design/composer.md` documents the two-tap rule.

Done check: on dev, the prompt enclosure contains no clear control at rest; hovering the character counter reveals it; one click leaves the draft and attachments intact and shows the armed state; a second click within 2 seconds clears them and undo restores; waiting 3 seconds between clicks leaves the draft intact; tests pass; 390px holds with the tap reveal. Commit.

## Job 10 — Download button moves into the top bar (2026-08-28, Willem). Verify: no

Goal: the floating download-chat button that hovers over the transcript (visible at the right edge on desktop and phone) goes away; the same action lives in the pane's top bar instead, as a bare icon. Files: the floating download control in the chat view (`src/components/chat/view/` and its subcomponents), the planner and worker pane top bars, `design/transcript-rows.md` or the area file that documents the pane top bar.

- [x] The floating button is removed entirely (no overlay element left in the transcript on any viewport).
- [x] The top bar of both the planner pane and the worker pane gains the download action as an icon-only button: the same icon, no background, no outline, no border; hover and press states follow the other top-bar icon buttons (window selector, shell), same size and spacing; same functionality and file output as before.
- [x] Desktop and phone; the area file documents the top bar's control set.

Done check: on dev, no download control exists inside the transcript area on either pane; each pane's top bar has the download icon button with transparent background and no border in computed style; clicking it downloads the same file as before; 390px holds. Commit.

## Job 11 — Every job row looks the same (2026-08-28, Willem). Verify: no

Goal: appended units of kind "task" render as smaller, indented, lighter rows in the jobs column (see "Ring breathing, no blur" and "Download in the top bar" in the ui17 chain); Willem wants one row format for every job, whatever its kind or origin. Files: `src/components/worker-pane/JobsSidebar.tsx` and its row pieces, the chain record's unit kind (`server/modules/watchdog/`, the append path in `scripts/macos/dispatch` and the runner), `design/worker-pane-and-jobs.md`.

- [x] The jobs column renders every unit with the same row anatomy, size, indent, ring and type treatment: no lighter or nested variant for "task" appends, no different ring, no smaller text; existing chains (ui17 included) render uniformly without any data migration, because the renderer ignores the kind.
- [x] The `dispatch append` default kind becomes phase (the `--phase` flag stays accepted and is a no-op); the runner and watchdog keep accepting the stored "task" kind for old records; the dispatch header comment and the planner reference are updated by the planner, not this job (say so in the summary).
- [x] The area file documents that units have one row style.

Done check: on dev with a stub chain that has one phase unit and one task-kind unit, both rows measure the same height, indent and font size and carry the same ring; `dispatch append` without `--phase` stores kind phase; tests pass. Commit.

## Job 12 — Fast mode shows as a bolt, not a word (2026-08-28, Willem). Verify: no

Goal: with fast mode on, the composer's model trigger shows a small muted `fast` text tag beside the model and effort; Willem wants a lightning bolt icon instead, nothing else changes. Files: the composer model trigger and menu (`src/components/chat/view/subcomponents/ComposerModelMenu.tsx` and the trigger it renders), `design/composer.md`.

- [x] When fast mode is enabled the trigger shows a small lightning bolt icon (the app's icon set, same muted ink and size as the trigger's chevron) in place of the `fast` text; nothing renders when it is off; the switch row inside the menu keeps its label and cost line.
- [x] Both panes, phone holds; `design/composer.md` updated.

Done check: on dev with fast mode on for a GPT-5.6 session the trigger contains the bolt icon and no `fast` text; off shows neither; 390px holds; tests pass. Commit.

## Job 13 — Fast mode per chain, switchable between jobs (2026-08-28, Willem, reverses the "chains never fast" rule). Verify: yes

Goal: Willem wants to run chain jobs in Codex fast mode when he chooses. A chain gets a fast flag, off by default, that he flips from the app; the runner reads it at the start of each build unit, so the switch takes effect on the next job with no restart and no token cost; the running job finishes on its current tier; verify stages never run fast. Files: `scripts/macos/dispatch` (new subcommand) and `dispatch-chain-runner` (per-unit launch), the watchdog chain record and routes (`server/modules/watchdog/`), the jobs column chain header and the worker pane header (`JobsSidebar.tsx`, `WorkerPane.tsx`), the Codex runtime provider where ui15 job 17 wired `service_tier`, `design/worker-pane-and-jobs.md`.

- [x] Chain record: a `fast_mode` boolean on the chain (0 by default), settable through an authenticated watchdog route and through `dispatch fast <project> <slug> on|off`; the change broadcasts so every open client updates.
- [x] Runner: at each build unit start it reads the chain's flag and, when on, launches the Codex unit with the same fast tier ui15 job 17 found for interactive sessions (the CLI's config key for `service_tier`), then confirms from the unit's rollout that the tier applied and journals `fast` on the phase start line; verify stages always launch on the standard tier; Claude units ignore the flag.
- [x] App: the running chain's header in the jobs column (and the worker pane header while a chain is followed) shows a bolt toggle in the app's monochrome language, off by default, one tap to flip, with a one-line hint on first arm ("next job runs fast"); units that ran fast carry the small bolt in their row.
- [x] `design/worker-pane-and-jobs.md` documents the toggle and the rule (next job, never the running one, never verify).

Done check: on dev with a stub chain: flipping the toggle stores the flag and the next stub unit's launch carries the fast tier while the running unit does not, the verify launch does not, the journal line says fast, the row shows the bolt; `dispatch fast` flips it from the shell; regression tests on the runner's launch arguments and the route. Commit.

## Job 14 — A failed verify never stops the chain (2026-08-28, Willem: make it never happen again). Verify: yes

Goal: three chains today died because one unit's verify came back FAIL (ui17 on a 25.5 versus 25 percent budget), killing every queued unit and parking the next job's work. The verify verdict stays valuable, but it must not be a kill switch. Files: `scripts/macos/dispatch-chain-runner` (verify handling, rewind, park), the watchdog chain routes and records (`server/modules/watchdog/`), the jobs column failure rendering, `design/worker-pane-and-jobs.md`, the planner's dispatch reference is updated by the planner (say so in the summary).

- [x] On VERIFY: FAIL the runner records the verdict on that unit (status verify-failed, the reason line), leaves its commit on main, does not kill the unit already building, does not rewind, does not park, and continues the chain; the chain ends `completed with N verify failures` and the terminal wake lists them with their reasons and resume points so the planner appends fix units.
- [x] A decision-needed notification fires at the moment of each verify failure (not a wake), naming the unit and reason, so Willem sees it in the moment.
- [x] The jobs column marks the unit with the red ring and X (Job 1's mark) while the chain keeps running; the chain header shows the failure count.
- [x] The only things that still stop a chain: a build unit that lands no commit (the commit gate), a usage limit the runner cannot recover from, and an explicit pause; regression tests cover verify-fail-continues, the notification, and the terminal wake payload.

Done check: on dev with a stub chain whose second unit's verify answers FAIL, the third unit still runs and the chain completes with one recorded verify failure, the notification fired, the wake payload lists the failure, the row shows the red mark; tests pass. Commit.

## Job 15: The unseen-response mark is a bell, and the wake tag leaves the row (2026-08-28, Willem, second report). Verify: no

Goal: Willem asked for a small bell on a session whose planner or worker finished a turn he has not looked at yet; what shipped is the stroke mark (`ResponseSignal`: one primary stroke for a planner response, two emerald strokes for a worker response), which he reads as a meaningless dash, and it appeared on old chats he had already read. Separately, the wake-target `wake` hover tag from ui16 Job 0 means nothing to him. Files: `src/components/sidebar/view/subcomponents/ResponseSignal.tsx`, `ChatRow.tsx`, `ChatRowMenu.tsx`, `SidebarProjectItem.tsx`, `SidebarFooter.tsx`, `src/hooks/useProjectsState.ts` (the unseen derivation), `design/sidebar.md`.

- [x] The mark is a bell: one small lucide `Bell` in muted ink, same slot and size budget as today's strokes, everywhere `ResponseSignal` renders (chat rows, collapsed project rows, the footer activity button); planner and worker no longer need separate glyphs in the row, the footer's own icons already tell them apart.
- [x] Meaning, exactly: the bell shows on a session whose planner or worker completed a turn after Willem last opened it, and it clears the moment he opens the session. Never backfilled: a session with no view record counts as seen, so no historical chat wears a bell after this ships; find in `useProjectsState.ts` why already-read chats got the mark and fix that cause, with the evidence in the summary.
- [x] The `wake` hover tag is gone from the row (no tag, no glyph, no hover state); which session receives watchdog wakes stays visible only inside the row menu where the move control already lives. Nothing about wake routing changes.

Done check: on dev with agent-browser: with session A open, a response landing in session B puts one `[data-slot="response-indicator"]` bell on B's row and none on A; opening B clears it; after a cold reload no row carries a bell for a session last touched before the current run; no `watchdog-wake-target-mark` element exists in any row at rest or on hover; tests pass. Commit.

## Job 16: Job rows tell the truth about ticks, verifies and long commands (2026-08-28, Willem: things display at the wrong times). Verify: yes

Goal: three display lies Willem hit today. The ui17r resume unit "Heap under budget" showed both tasks ticked the instant it started, because its punch-list items were already checked by the ui17 run it replaces (`observeTaskCheckoffs` stamps every already-checked item at phase start). The ui17 footer-icons job reads "Job stopped before completion" although its commit ac73a56 is on main; the chain died on job 3's verify before job 4's verify ran. And a verify-failed job that a later unit repaired (ui15r5 job 8, Streaming off and tokens, fixed by ui15r6 unit 1) still reads "Verify failed" to him. Files: `server/modules/watchdog/watchdog.service.ts` (phase start, `observeTaskCheckoffs`), `scripts/macos/dispatch-chain-runner` (phase start), `src/components/worker-pane/JobsSidebar.tsx` (`baseUnitStatus`, `VerifyRow`, `FailureReason`, the repair-truth map), the Codex rollout reader behind the worker pane transcript, tests, `design/worker-pane-and-jobs.md`.

- [x] Ticks start from zero for a re-run: at phase start the runner unchecks the punch-list items of the job a unit supersedes (its own small pathspec commit, `docs(dispatch): reset <job> for <slug>`), so the worker re-checks them as it verifies; and the watchdog records a tick only for a check-off that happens after the unit's own start (baseline the done count at phase start), so no unit can ever open with tasks already done.
- [x] A unit whose build committed never reads stopped: when the chain ended before its verify ran, the row reads done and its drawer carries one muted line, "Verify never ran, chain ended"; the red ring and the "stopped before completion" line are only for a unit with no commit.
- [x] A verify failure that a superseding unit fixed reads done everywhere, drawer included: no red "Verify failed" row, only the existing fixed-in note. Reproduce with the live chain rows copied to dev by the memory repo's recipe (lesson copy-chain-rows-live-to-dev-by-named-columns), find why ui15r5 job 8 still shows the failure, fix the cause.
- [x] A Codex unit in the middle of a long shell command is visibly alive in the worker pane: while a command is in flight the transcript shows one live row with the command's first line and a running elapsed time, replaced by the real output row when it lands (unit 1 of ui17r ran a 12-minute memory scenario twice and the pane looked dead both times).

Done check: on dev with the stub chain fixture: a resume unit over an already-checked job opens at 0 of N and ticks as items are re-checked; a committed unit with no verify in an ended chain reads done with the note; a repaired verify failure shows no red row; a Codex session mid-command shows the live row with elapsed time; tests pass. Commit.

## Job 17: The Handoff button spawns the successor at once (2026-08-28, Willem: it should always start a new session). Verify: yes

Goal: clicking Handoff runs /handoff and then nothing happens, because the follow-through that boots the next planner sits behind the Settings switch "Handoff follow-through", off by default; Willem has now decided the button always follows through. He wants the new session to appear instantly with the loading animation until the handoff has fully landed and the successor has booted. Files: the Handoff button in the composer controls row (`src/components/chat/view/subcomponents/ChatComposer.tsx` and its controls), `server/modules/websocket/services/chat-websocket.service.ts` (the /handoff turn hook), `server/index.ts`, `server/modules/watchdog/watchdog.service.ts` (`plannerHandoffComplete`), `server/modules/watchdog/handoff-push.ts`, `server/modules/settings/settings.service.ts` and `src/components/settings/view/tabs/SystemSettingsTab.tsx` (`handoffAutomation`), the session lineage columns in `server/modules/database/repositories/sessions.db.ts`, `design/composer.md`, `design/sidebar.md`.

- [x] Clicking Handoff creates the successor session at once: a new planner-origin row for the same project with its lineage set, shown in the sidebar in a loading state, and the planner pane switches to it with the loading animation while /handoff runs in the old session; when the old session's /handoff turn completes cleanly and the push check passes, the successor boots with /planner in that row, and the loading state holds until the boot's opening message lands.
- [x] The Handoff button and a typed /handoff always follow through; the "Handoff follow-through" switch leaves Settings and its config key is dropped (Willem's own action is the consent). "Planner auto-rotation" still governs the watchdog's own rotations and stays off by default, untouched.
- [x] Failure stays visible: a handoff turn that errors or aborts leaves the placeholder row in place with one line saying what went wrong, and the old session stays where it was; never a silent roll back.
- [x] Phone parity: the same flow at 390px, the new row and loading pane reachable from the bottom taskbar.

Done check: on dev: clicking Handoff on a planner session shows a new loading row and a loading planner pane within a second; after the handoff turn ends the successor boots and its opening lands in that row; the follow-through switch no longer exists in Settings and the key is gone from app_config; an aborted handoff shows the failure line; tests pass. Commit.

## Job 18: Promote pauses and resumes running chains itself (2026-08-28, Willem: a paused worker must never happen again). Verify: yes

Goal: the mid-chain promote at 7:40 pm needed the planner to pause ui17r first (the tag guard refuses a commit a running chain is building), and the promote's live restart severs the planner's own turn, so the resume waited on Willem's next message; the chain sat paused from 7:40 pm to 10:45 pm. The promote must own the whole dance so no human and no planner turn is in the loop. Files: `scripts/macos/promote.sh`, `scripts/macos/dispatch` (the pause and resume subcommands and what they call), the watchdog chain routes and records in `server/modules/watchdog/`, tests, the planner's dispatch reference is updated by the planner (say so in the summary).

- [x] promote.sh finds every chain running in the project (watchdog rows with status running), pauses each through the same path `dispatch pause` uses before the drain step, journals `HH:MM | run | PAUSED | promote` on each, and after the post-promote health check passes resumes each through the `dispatch resume` path, journaling the resume; the runner continues from the unit it was on or the next.
- [x] A promote that aborts, fails its health check, or rolls back still resumes every chain it paused; a resume that fails fires a decision-needed notification naming the slug and the reason, never a silent stall.
- [x] The tag guard stays as the safety net but is never the reason a human acts: with the pause folded in, `promote.sh` runs to completion on a repo with a running chain and no manual step; `promote --tag-guard` dry run unchanged.
- [x] A pause never kills a running verify: when a chain is paused (by promote or by `dispatch pause`) while a unit's verify stage is mid-run, the pause waits for that verify to finish (bounded by the verify's own timeout) and records its verdict; today the 7:40 pm pause left ui17r unit 1 (the heap fix) with verify `stopped`, so that fix is unverified.
- [x] A dry-run flag exercises the pause and resume steps without building or restarting (pointed at dev per the memory repo lesson promote-tag-guard-dry-run-on-dev), and regression tests cover pause before drain, resume after health, and resume after rollback.

Done check: on dev with a stub chain registered mid-phase, the dry run pauses it before the drain step and it is running again after the health step, both journal lines present; the abort path resumes it too; tests pass. Commit.

## Job 19: Worker pane truth: scroll stays where Willem put it, and the figures mean what they say (2026-08-28, Willem). Verify: yes

Goal: scrolling up in the worker pane keeps getting dragged back to the bottom by the follow-output repin. The pane's token figure showed 12 to 14 million "spent" on the mobile taskbar unit fifteen minutes in, which read as a runaway; the real numbers were 133 thousand output tokens and 24.9 million cache reads (each turn re-reads the context from cache). And the context meter showed 98 percent of 200 thousand while the session's own calls were already past 204 thousand and succeeding: Opus 5's window is 1 million, but no window is persisted for `claude-opus-5` because dispatched headless sessions never report one, so the meter falls back to the 200 thousand guess. Files: the worker pane transcript scroller and its follow logic (`src/components/worker-pane/WorkerPane.tsx`, the message scroller hook, memory repo lessons follow-output-repin-needs-spacer-not-padding and message-scroller-guard-misreads-long-repins), the pane's usage footer, `server/modules/providers/services/provider-token-usage.service.ts`, the Claude runtime provider's window persistence, `design/worker-pane-and-jobs.md`.

- [ ] Scrolling up releases follow: while the user is above the bottom the pane never repins on new rows; follow returns only when they scroll back to the bottom or tap the existing jump-to-latest control; the same on the planner pane and at a phone viewport; a regression test drives new rows in while scrolled up and asserts scrollTop holds.
- [ ] The runaway spacer is gone: mid-stream, on either pane, the transcript sometimes jumps so the last rows sit at the top of the pane with roughly 600px of empty space below them before the composer, the wheel and trackpad do nothing, and only a page refresh recovers (Willem's screenshot 2026-08-29 12:20 am, planner pane, a Fable turn with a run of Bash rows, a Thought row and a Percolating row; the empty region is pane background, not a rendered element). Find the cause with evidence (the memory repo lessons follow-output-repin-needs-spacer-not-padding and message-scroller-guard-misreads-long-repins and content-visibility-breaks-scroll-truth describe the mechanism and past misreads): the bottom spacer or pinned padding grows past the viewport and the scroll guard treats the result as a long repin, so the scroller locks; fix it at the source so the spacer can never exceed the space below the last row and the scroll position can never be locked, with a reproduction recipe in the summary and a regression test that streams a long turn of short rows and asserts scrollHeight minus the last row's bottom never exceeds the viewport and wheel scrolling moves scrollTop.
- [ ] The token figure separates what costs from what is cached: the footer shows fresh input plus output as the spend figure, and cache reads as their own quiet secondary figure (never summed into "tokens spent"); the job drawer's token line follows the same split.
- [ ] The context meter uses the model's real window: the server persists Claude windows for headless dispatched sessions too (from the same SDK-reported usable window a live turn observes), and ships a seeded default of 1 million for `claude-opus-5` and `claude-sonnet-5` alongside the existing Fable and Opus 4.8 entries; a session past 200 thousand on a 1 million model reads as 20 percent, not 98.

Done check: on dev with agent-browser on a session with a long transcript: a streamed stub turn of 60 short tool rows never leaves more than one viewport of empty space below the last row and scrollTop stays movable throughout; scroll up 800px, inject three new rows through the stub, scrollTop unchanged; the footer shows the split figures against a fixture with known usage; the meter for a `claude-opus-5` session with 204,614 cache-read tokens reads 20 percent of 1 million; tests pass. Commit.

## Job 20: Headless Claude units stop living in Bash (2026-08-29, Willem: the worker only runs bash commands). Verify: yes

Goal: every dispatched Claude unit runs `claude -p --dangerously-skip-permissions`, and in that mode the Claude Code harness injects an instruction to do all work through Bash (cat, sed, heredocs) instead of Read, Edit and Write. Measured on 2026-08-28: Fable units 87 Bash to 3 Write, Opus 5 units 152 Bash to 4 edits, whole files dumped into context (205k after 15 minutes), memory writes that the attribution watcher had to special-case. A probe on 2026-08-29 12:05 am in /tmp/harness-probe with Sonnet 5 at low effort: the same prompt under bypass used Bash to read package.json; under `--permission-mode acceptEdits --allowedTools "Bash,WebFetch,WebSearch"` it used Read, and nothing prompted. Files: `scripts/macos/dispatch-chain-runner` (`run_claude`), the agent route's headless spawn for direct runs (`server/modules/providers/` where `-p` sessions are launched with the same flag), the verify stage if it spawns Claude anywhere, tests, CLAUDE.md gotcha line.

- [ ] `run_claude` drops `--dangerously-skip-permissions` for `--permission-mode acceptEdits --allowedTools <list>`, the list covering every tool a unit legitimately uses without a prompt (Bash, WebFetch, WebSearch, Agent, Skill, ToolSearch, Monitor, TaskOutput, and whatever a probe shows still prompts); a headless probe that exercises each listed tool completes with no permission denial; the destructive-git PreToolUse hook still fires under the new mode (prove it with a blocked `git push --force` attempt in the probe).
- [ ] Direct runs launched through the agent route get the same treatment, so a `/worker` session on Claude reads with Read and edits with Edit.
- [ ] Evidence in the summary: tool mix of a stub unit before and after (Bash versus Read, Edit, Write counts) and its context size at the end; the runner journal line for a Claude phase names the permission mode.
- [ ] The phase prompt template no longer needs the "read with the Read tool" line once the mode is fixed; leave it, it is harmless, but note in CLAUDE.md in one line that bypass mode steers Claude to Bash and why the runner avoids it.

Done check: on dev with the stub chain: a Claude unit runs to commit under acceptEdits with zero permission denials in its log, the git hook blocks the probe's forced push, and the tool mix shows Read and Edit in use; tests pass. Commit.

## Job 21: The aborted handoff successor shows its reason (2026-08-29, verify finding on Job 17). Verify: yes

Goal: Job 17 landed at b8aadb5 and its verify failed on one thing: opening a persisted successor whose boot aborted renders an empty planner pane. The record carries `bootState: "failed"` and the abort reason, but the pane renders neither the reason line nor the Retry control (verify log `~/forge-logs/ui17r/verify15.log`, successor `9ba1356a` on dev). Files: the planner pane's successor loading and failure rendering from Job 17 (`src/components/chat/` loading row and failed state pieces, the session boot state read on load), `design/composer.md` and `design/sidebar.md` where Job 17 documented the flow.

- [x] A successor with `bootState` failed renders, on cold load and live alike, the one-line reason and the Retry control in the planner pane and the sidebar row, at desktop and 390px; a regression test loads a persisted failed successor and asserts both are visible.
- [x] Retry re-runs the boot in the same row; a second failure replaces the reason line; success clears it and the opening lands in the row.

Done check: on dev with agent-browser, opening the stub's persisted failed successor shows the reason line and the Retry control (cold load, then again after a live abort), at desktop and 390px; tests pass. Commit.

## Job 22: A running chain picks up runner fixes, and its wakes reach a planner that is alive (2026-08-29, Willem: the worker stopped, never again). Verify: yes

Goal: two causes behind the 1:54 am death. First, Job 14 (verify never stops a chain) landed at 11:02 pm, but the ui17r runner process was started at 10:45 pm and zsh runs the script inode it opened at spawn (memory repo lesson running-chain-holds-old-runner-inode), so the old kill-on-verify-fail code ran for three more hours and killed the chain when Job 17's verify failed. Second, the chain's dispatching session (c853be3a) was a planner that had been handed off; the terminal wake and the verify-failure notice went to it, and the planner Willem was actually talking to (a manually started session) learned about the death from him at 2:06 am. Files: `scripts/macos/dispatch-chain-runner`, `scripts/macos/dispatch`, `server/modules/watchdog/watchdog.service.ts` (wake routing, lineage), the sessions repository, tests, CLAUDE.md gotcha line.

- [ ] At every unit boundary (after a commit gate, before the next unit starts) the runner re-executes itself from disk when the script on disk differs from the one it started with (compare a content hash taken at spawn), carrying its state through the existing resume.json so nothing about the chain changes; the journal logs `runner reloaded at <hash>`; a regression test edits the runner mid-chain on the stub and proves the next unit runs the new code.
- [ ] Wakes and decision notices for a chain go to a planner that is alive: when the dispatching session and its handoff lineage are all ended, archived, or missing from the transcript store, the watchdog routes to the newest planner-origin session for the project that has booted through `/planner` and is still open; the chain row's `dispatching_session_id` is updated to it and journaled; side chats that never booted as a planner still never receive wakes. Willem's 2026-08-27 rule (wakes follow the dispatching lineage) stays the first choice; this is the fallback when that lineage is dead.
- [ ] `dispatch` refuses to register a chain whose resolved dispatching session is not open right now, and says which session it would have used, so a chain can never be born pointing at a dead planner.
- [ ] The verify-failure decision notice from Job 14 is proven on the stub chain under the reloaded runner: a FAIL verdict produces the notice and the chain continues.

Done check: on dev with the stub chain: a runner edit mid-chain is picked up at the next boundary (journal line present, new behavior observed); with the dispatching session archived, the terminal wake lands in the newest open planner session for the project and the chain row points at it; dispatch against a project whose only planner session is archived exits non-zero with the message; a stub verify FAIL notifies and the chain continues; tests pass. Commit.
