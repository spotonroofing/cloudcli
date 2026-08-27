# PUNCHLIST_ui15 — snapping dividers, claude.ai composer, jobs view polish, themes, usage alerts, images, surprises

## Goal

Willem's pre-build polish round on the ui14 app. Dividers snap to notches, the composer adopts the claude.ai layout with clear/undo and prompt history, the jobs view gets duration detail and month grouping, settings gain a System tab and sounds, themes get depth, fleet-wide usage alerts arrive, inline images are verified end to end with remote URLs, and a sealed job ships seasonal surprises. Dev-first, end-to-end verification, promote without an eyeball gate.

## Stack and decisions already made

- Verifier scope per doctrine: each job below carries "Verify: yes" (fresh-context verifier) or "Verify: no" (UI-only, Willem's eye is the reviewer).
- Standing laws: personal-tool wording, drawers not popups, ramped motion, monochromatic with semantic status color, DESIGN.md consistency, mobile parity, no em dashes in UI copy, label caps, rebuild discipline, pathspec commits for any planner files.
- Tooltips stay banned except non-self-evident icon controls; the commit footer in a job drawer is sanctioned for one (tiny space, real need).

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to DESIGN.md.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Rerun rules (ui15r2r, 2026-08-27): browser and UI checks use agent-browser against dev; Codex's computer-use tool is not installed on this machine (it needs an OpenAI helper called orca), never attempt it. Jobs run on Codex GPT-5.6 Sol with the runner's verify stage (Terra); do not spawn subagents and skip any "fresh-context subagent" wording in a done check, the runner's verify stage is that check. Items marked done in the codex round stay checked; do not redo them. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0 — Context diet (2026-08-27 spend audit). Verify: yes

Goal: cut what every session re-reads on every turn. The 7-day audit measured ~300k tokens re-read per planner turn and ~250k per worker turn across 150+ sessions; the standing context, not the model's writing, is the spend. Files: DESIGN.md (94KB today), the SDK runtime provider (session spawn options), the watchdog wake policy, the dispatch runner and its verify stage, the worker pane header, DESIGN.md itself. Dependencies: none; runs first.

- [x] (done, codex round) DESIGN.md becomes an index plus per-area files (design/<area>.md: tokens, sidebar, transcript rows, composer, worker pane and jobs, settings, motion, mobile): the index lists areas with one line each and the rule "read only the areas your files touch"; update CLAUDE.md's pointer and the consistency tail wording that the planner compiles (the planner updates doctrine; you update the repo side).
- [x] Headless and machine sessions run without MCP servers: dispatched phases and verify stages (the runner already passes an empty strict MCP config as of today; confirm it holds and that verify-stage spawns use the same flags), watchdog wakes, maintenance, and memory-edit one-offs spawned by the app pass an empty strict MCP config through the SDK options; planner sessions keep only the servers a planner uses (spoton-core, spoton-sign, playwright; twilio, resend, cloudflare, github, railway, forge-propagator become opt-in per project via settings). Measure the system-prompt token delta in the summary.
- [x] Watchdog notices that need no decision (limit hit and auto-recovering, switch, park) become notifications and system rows, never planner wakes; only terminal events (completed, stopped, failed) and genuine decisions wake the planner.
- [x] (done, pauseresume job 1) `dispatch pause <project> <slug>` and `dispatch resume <project> <slug>`: pause stops the runner and its phase cleanly (WIP parked as today, journal line, chain marked paused in the watchdog, jobs view shows paused); resume restarts from the first unfinished job in the same chain record (no duplicate jobs, no new slug).
- [x] Worker stop button: while a worker turn runs, the worker pane's send button becomes the stop square exactly like the planner's, and stopping a dispatched phase pauses the chain through `dispatch pause` (landed in pauseresume job 1).
- [x] Effort switcher truth: prove the composer's effort switch changes the running session's effort for the next turn (read it back from the session's transcript or rollout), on Claude and Codex; if it is cosmetic anywhere, wire it; state in the summary what a mid-session switch costs (context reload or none).
- [x] (done, codex job 1) Watchdog scope pass: inventory every automatic behavior the watchdog performs (planner rotation, wakes per event kind, liveness sweep, resource alerts, weekly self-test, maintenance run, chain drains, memory/handoff triggers, anything else found) and for each: a one-line plain description, an on/off in the System tab with the current default shown, and a hard rule that anything acting on Willem's own sessions (rotation, spawning sessions, handoffs) defaults OFF and only he can turn it on; nothing reads settings from a code default when a stored setting exists, and the planner never edits these settings directly. Remove behaviors that serve nothing; list them in the summary.
- [x] The jobs column's open/closed state persists (settings store, per device-agnostic like everything else) so a refresh never closes it.
- [x] (done, codex job 5) Resume-chain supersession: as soon as a resume chain starts, hide the earlier chain's failed, stopped, and never-reached jobs from jobs history while keeping every record in the database. A resume chain supersedes its earlier chain (ui15 by ui15r, ui15r by ui15r2), matched by an explicit `<!-- supersedes: slug/n, slug/n -->` header carrying one or several comma-separated targets when present, or by the same punch list file plus job section otherwise. Apply the rule retroactively to ui11/ui11r, ui13/ui13r, and ui15/ui15r/ui15r2.

- [x] (ui15r3 verify finding, 2026-08-27) The external agent route (`server/modules/agent/agent.routes.ts`, the `isDispatch` branch near line 1001 and the Claude and Codex launches near lines 1048 and 1070) treats every non-direct, non-planner origin as a machine session yet launches Claude and Codex without the empty strict MCP policy; those launches pass `mcpPolicy: 'none'` (Claude) and the equivalent empty MCP config (Codex) exactly as the dispatch runner path does, with a test that asserts both launch calls carry it. Done check for this item: the test passes and a headless run through the agent route with a dispatch origin logs zero MCP tools.

Done check: on dev: DESIGN.md is under 8KB and the area files exist; a headless stub phase's system prompt carries no MCP tools (log the tool list length before and after); a stub "auto-recovering" event produces a notification and no planner wake; `dispatch pause` then `dispatch resume` on a stub chain resumes at the right job with one record; the worker stop square pauses a stub chain; the jobs column stays open across reload; starting a resume chain hides the superseded failed, stopped, and never-reached jobs for the named retroactive chain pairs without deleting their database rows. Fresh-context subagent verification. Commit.

## Job 1 — Dividers: smooth and notched. Verify: yes

Goal: dragging the planner/worker divider feels instant and lands on deliberate notches. Files: the pane divider and resize logic, DESIGN.md. Dependencies: none.

- [x] Fix the drag lag: the divider tracks the pointer with no visible trailing (per the framer lesson, position must apply instantly; profile and remove whatever animates or re-renders per pointermove); verify with synthetic pointermoves asserting next-frame position.
- [x] Notched resizing: the divider snaps to a predetermined set of stops (even splits and sensible intermediate fractions; not too sparse, not too dense — pick, state the set); while dragging, small guide lines appear along the bottom of the paired panes marking the stops, the center stop's line double height; release snaps to the nearest stop with a short ramped settle; guides fade out after release.

Done check: on dev: synthetic drag shows next-frame tracking (no lag frames); release between stops lands exactly on the nearest stop; guide lines render only while dragging, center line 2x height; works for two-pane and project-column dividers; phone unaffected (touch resize unchanged or consistent). Fresh-context subagent verification. Commit.

## Job 2 — Composer: claude.ai layout, clear with undo, prompt history. Verify: yes

Goal: the composer works like claude.ai's: text spans the full width above the controls row, attachments ride above the text, clearing is deliberate and undoable, and past prompts are browsable. Files: ChatComposer and its rows, attachment strip, a prompt-history panel plus its server source (sent messages already persist), DESIGN.md. Dependencies: none.

- [x] Layout: the text area spans the enclosure's full width, sitting above the bottom controls row (plus button, mode/model switcher, send on their own row below the text); attachment previews sit above the text, left-aligned with it, proportionally sized, and horizontally scrollable when they overflow the row; no dead space columns left or right of the text.
- [x] Spellcheck squiggles gone: the prompt input (and every input in the app) renders no browser spell/grammar underline (spellcheck, autocorrect, autocapitalize attributes set deliberately; sweep inputs).
- [x] Clear with undo: hovering the character counter fades it into an X; clicking clears the prompt and swaps in an "Undo?" affordance with a depleting indicator (a few seconds, ramped); clicking undo restores the exact prompt and attachments; letting it deplete finalizes the clear. Keyboard-safe on mobile (tap works).
- [x] The Handoff button returns as a visible control in the bottom row: leftmost of the group sitting left of the model switcher (handoff, then prompt history, then the switcher); remove the Handoff entry from the plus menu (Willem's call, no longer the worker's).
- [x] Multiple queued messages: queueing while one is already queued stacks a second (and third...) instead of replacing the first; the stack renders as separate queued cards above the composer pushing the chat up proportionally; delivery preserves order (steer them into the running turn in sequence at boundaries, or in order at turn end), each landing as its own bubble; server-side per-session storage holds the whole stack per the ui12 rules; editing or deleting any single queued card works.
- [x] Drop anywhere on the pane: dragging a file over the planner or worker pane highlights that pane (subtle, themed) and dropping attaches it to that pane's composer, exactly as if dropped on the prompt bar; works per pane in multi-pane layouts.
- [x] Queued card clears in sync: today the message bubble appears in the transcript and the queued card above the composer lingers a couple of seconds before clearing; the card must clear in the same frame the bubble lands (drive both from one event, not two round trips), with the ramped collapse.
- [x] Prompt history: a history button left of the model switcher, matching the row's icon language; it expands the prompt bar area into a panel about a third of the pane height listing his previous prompts (this session's and the project's recent ones), newest first, each row expanding to the full text and its attachments, files downloadable (they live on the mini); a row's "use" action loads it into the composer; closes with the same ramp.

Done check: on dev: DOM shows text row full-width above the controls row; attachments scroll horizontally when overflowing; no spellcheck attribute left default-on in any input; clear then undo restores text and attachments, depletion finalizes; history opens at ~1/3 pane height, expands a prompt with files, downloads work, use loads the composer; phone viewport holds. Fresh-context subagent verification. Commit.

## Job 3 — Jobs view: durations, grouping, width, mono text. Verify: yes

Goal: the job list reads like a clean history with real timing. Files: the jobs view components, the watchdog timing data, DESIGN.md. Dependencies: none.

- [ ] Task rows indent less (pull the task list left; state the new indent); the jobs sidebar gets ~20px wider so titles stop clipping; the drawer footer's items sit comfortably; the commit name gets a tooltip carrying the full subject (sanctioned exception).
- [ ] Per-task durations on hover: hovering a completed task shows its duration on the row's right; a running task shows a live counter there, and the drawer footer's total ticks live (both lining tabular, "1m 50s" format).
- [ ] Completed job icon: a finished job shows its segmented ring fully filled with a checkmark drawn in the center (replacing the plain check icon); jobs only, task rows keep their plain check. Applies to every job in the history (all previous runs), not just new ones.
- [ ] Failed job icon: a failed or stopped job shows the same segmented ring with the segments of its failed (or unreached) tasks in red, completed segments filled normally, and an X drawn in the center; historical failed jobs render the same way where the record knows which task it died on (fall back to a plain red-ring X when it does not).
- [ ] Task and job text is monochromatic: no green text anywhere in the list (icons and counters keep their semantic color); a failed task's text goes red, and opening its job's footer shows the failure reason in one line.
- [ ] The verify row reads like a task: the pipelined verify stage renders in the job drawer as a task-style row (same anatomy) labeled "Verifying <the job's short name>", spinner while running, and it exists only while a verify stage is genuinely running for that job — no standing "Verifying" rows, none for jobs whose verify already settled or that only get the render-sanity pass unless that pass is actually in flight.
- [ ] Month grouping: when the month rolls over, prior-month jobs group under a clean month row (not indented, just visually grouped) with a jobs-done count on the right; years group the same way when the year rolls; the continuous bottom-to-top order holds inside groups. Test with stubbed dates.

- [ ] (Willem, 2026-08-27 evening) Chain-less runs in the jobs column (one-off headless runs, wakes, maintenance, anything without a chain slug) get a real label: the run's kind in plain words plus its model and a 12-hour Eastern start time (for example "One-off, Sol, 5:40 pm"), never a fragment of the prompt text or a bare date; the `run <id>` and prompt-title fallbacks in `WorkerPane.tsx` (near line 87) and `Sidebar.tsx` (near line 245) go away. Today the top of Willem's jobs column reads "run 2026-08-27".

Done check: on dev with stub history spanning two months: indent reduced, sidebar wider with no clipped titles, hover shows durations, running task ticks live, no green text (computed styles), failed task red with reason in the footer, month rows with counts render and group correctly under stubbed dates. Phone holds. Fresh-context subagent verification. Commit.

## Job 4 — Memory surface: the diff preview for real, padding, copy. Verify: yes

Goal: the memory row finally shows what changed, and the memory popout's prompt bar sits right. Files: the memory indicator row and its expansion, the memory popout, DESIGN.md. Dependencies: none.

- [ ] Second report: expanding a memory-updated row still shows only the file name. ui14 job 3 claimed a diff preview; reproduce on live surfaces, find why it does not render (data not sent, renderer path, or the expansion showing the wrong slot), and fix so the expansion lists the actual changed lines (compact, changes only, never the whole file), next to or under the file name. Regression test.
- [ ] Watchdog messages stop looking like Willem's: turns originating from the watchdog (wakes, rotation prompts, chain events) get a different color or some other creative indication that they are not from him (his words), never a user message bubble — the meta-row family's language is the starting point (leading icon, muted treatment, compact one-line summary, expandable to the full text), visually unmistakable as machine-to-planner; creative freedom on the exact form within the row anatomy. Applies live and on reload; detection keyed on the message's origin, not text matching.
- [ ] Interrupted tells the truth: Willem sees an "Interrupted" row while an Agent chip above it still spins — reconcile row state with turn state so an interrupted turn stops every running indicator in that turn (agent chips included), the Interrupted marker renders only for genuinely killed turns, and nothing animates after it; if the marker cannot be made truthful for a case, it does not render for that case.
- [ ] Status rows carry exact times: "Thought for a few seconds" becomes "Thought for 12.4s" (the real duration, lining tabular digits, the app's duration format); every row that can hang shows its duration once done (tool calls, agent rows, research rows, memory writes) in the same muted meta slot, so an abnormally long step stands out at a glance; long-running rows show a live counter while in flight.
- [ ] The live turn indicator tells the truth: the row Willem sees while a turn runs ("Churning" with its counter) reflects the actual phase — thinking during thinking blocks, writing during text, the tool row itself during tool calls — with the wording chosen to match (Thinking / Writing); never a generic churn label while nothing is happening; its counter is the phase's elapsed time.
- [ ] Memory popout: the padding above its prompt bar equals the padding below it; the placeholder reads "Iterate memory..." (he removes more than he adds; never "Remember that").

Done check: on dev: a real memory write's row expands to the changed lines; popout paddings measure equal; placeholder text correct. Phone holds. Fresh-context subagent verification. Commit.

## Job 5 — Settings: System tab, sounds, and the missing obvious. Verify: yes

Goal: settings grow up: a System tab first, sound choices per pane, and the obviously missing configuration added. Files: the settings surface, notification/sound wiring, DESIGN.md. Dependencies: none.

- [x] (done, codex job 1) A System tab, first in the tab order: planner auto-rotation moves here from Notifications, alongside the genuinely systemic settings (rotation threshold, anything server-behavior shaped that currently hides elsewhere or nowhere).
- [ ] Sounds: ship a small set of distinct completion/notification sounds (tasteful, short); the planner's and the worker's completion sounds are independently selectable, with a preview play button per option; selections sync via the settings store like everything else.
- [ ] Configuration pass: sweep the app for behaviors that are currently hardcoded but obviously belong in settings (examples to evaluate, not mandates: default model/effort for new sessions, send-on-enter behavior, sound on/off per event kind, theme follow-system, sidebar defaults); add the clearly-worthwhile ones to the right tabs, wired end to end; list what was added and what was considered and skipped in the summary.

Done check: on dev: System tab first with rotation settings functional; two different sounds selected for planner and worker fire on their completion events; each added setting round-trips through the settings store across two browser profiles. Fresh-context subagent verification. Commit.

## Job 6 — Themes: dots on the right, real depth, more of them. Verify: no

Goal: the theme picker looks intentional and the theme list stops being thin. Files: themes definitions, the theme dropdown, DESIGN.md. Dependencies: none.

- [ ] Theme dropdown: palette dots right-aligned in the row, visible only on the hovered (or focused) option so labels never truncate, and a touch bigger.
- [ ] Add a set of new fully-layered themes (roughly double the current count): each with independently designed surfaces, inks, borders, and accents (the ui10 layered-theme bar), monochromatic-icon friendly, no one-hue-everywhere recolors; name them plainly; every theme verified against the mark, rings, and semantic status colors.

Done check: on dev: dots render right-aligned on hover only and larger; each new theme switches all four token families (computed styles) and passes a quick contrast sanity on text tokens. Willem's eye judges taste. Commit.

## Job 7 — Usage alerts: per-account and fleet-wide. Verify: yes

Goal: Willem hears about limits before they bite, and only when it matters. Files: the watchdog/notification layer, the cswap status source the account switcher already reads, DESIGN.md for the toast. Dependencies: none.

- [ ] Per-account 5h alerts at 75%, 90%, and exhausted, fired only when no other enabled account has real headroom to swap to (if a swap target exists, stay silent; if the best target is nearly dry, say so in the one alert). Toast in-app plus the existing push path, one alert per threshold crossing, no repeats.
- [ ] Fleet-wide aggregates: sum usage across all managed accounts into one fleet percentage per window; alert at 90% for the 7-day window and at 75% and 90% for Fable (and 5h same thresholds); worded plainly ("Fleet Fable window at 90%").
- [ ] True-exhaustion recovery for interactive turns: chains already switch or sleep-until-reset (verify that path still holds with spend-cap parking), but a planner or worker turn that dies on a limit with every account dry just sits failed today. When a turn fails on a limit and cswap reports no headroom anywhere, the server schedules an automatic retry of that turn at the earliest reset (or sooner if cswap reports headroom back), shows a quiet system row "waiting for a session window, resumes ~HH:MM", and the retry rides the normal send path so a queued stack stays intact. Verify both the chain path and the interactive path with stubbed all-dry cswap status.
- [ ] Parking never disables an account: ui14's spend-cap parking ran `cswap disable`, which flipped jarrod@ and team@ to disabled in Willem's switcher without him; only Willem may enable or disable accounts. Replace with a runner-side skip list (the existing park markers) that cswap switching consults through the runner's own switch logic, leaving cswap's enabled flags untouched; the account switcher shows a parked account as "parked until <date>" with a one-click unpark; the park markers the planner cleared on 2026-08-27 are the format to keep.
- [ ] Account usage is near-real-time: the switcher showed stale percentages for team@ (it read as healthy while capped). Usage refreshes on a short cadence while the switcher or a usage surface is visible, immediately on open, on every cswap switch or limit event, and stays cheap when nothing is watching (the daemon already polls each minute; reuse its readings rather than adding calls; push updates over the existing WebSocket). Show a "updated Xs ago" hint in the muted meta style so staleness is never silent.
- [ ] The thresholds live in the System tab (landed in the codex round) with sane defaults as above.
- [ ] The ChatGPT account (in the switcher since codex job 3, 7-day window only on this plan) is covered by the same thresholds and alerts, worded for its window; it never counts as a swap target for Claude limits.

Done check: on dev with stubbed cswap status feeds: crossing each threshold fires exactly one toast with correct wording and gating (no alert when a fresh account exists), and threshold edits in settings change behavior. Fresh-context subagent verification. Commit.

## Job 8 — Images end to end, including remote URLs. Verify: yes

Goal: image presentation in both panes is verified working and polished, and research imagery can render straight from a URL. Files: the transcript image card and preview, the asset route, the renderer, DESIGN.md, CLAUDE.md (the documented marker). Dependencies: none.

- [ ] End-to-end verification of inline images in the planner and worker panes: a worker-produced set of images (SVG and PNG) renders as clean image cards (bordered, fit-contained, grid when several), opens in the zoom preview, works on phone; fix any gaps found; polish the multi-image presentation (an icon-set preview should look deliberate, e.g. a small grid with even gutters).
- [ ] Remote images: an https image URL in a transcript image marker renders the same card directly from the URL (no download step), with graceful failure on a dead link; document the URL form next to the path form in CLAUDE.md; workspace-path scoping for local files stays strict.

Done check: on dev: a message with three local images and one remote URL renders a tidy grid, all four zoomable, dead-link case shows the graceful fallback; phone holds; CLAUDE.md documents both forms. Fresh-context subagent verification. Commit.

## Job 9 — Seasonal surprises (sealed). Verify: no

Goal: subtle, date-gated delight on a few dates that matter to Willem: Halloween, the Christmas season, September 5, and April 1. The specifics are deliberately unspecified: design them yourself, tasteful and quiet, nothing intrusive, nothing that interferes with work, reduced-motion respected, and keep the details out of this file, the summary, and the commit message (use "feat(ui): seasonal touches"). They must survive future frontend iteration (small, self-contained, date-gated at one integration point).

- [ ] Ship the surprises as described above; verify each renders only within its date window (mocked clock) and that normal days show nothing; summary says only "seasonal touches shipped and date-verified".

Done check: mocked-date renders for each window plus a normal-day nothing-check; no spoilers anywhere. Commit.

## Job 10 — Sidebar alignment and response indicators (appended 2026-08-27). Verify: no

Goal: chat rows align to the New session button's edge, and responses announce themselves subtly. Files: the sidebar rows, the footer counter drawer, DESIGN.md. Dependencies: none.

- [ ] Chat row alignment: the whole row block (dot plus title) shifts right together so the dot touches an imaginary 1px line at the New session button's left edge, with the dot-to-title gap unchanged; the title column simply gains the width the shift frees up (longer names before truncation); consistent in both tabs and nested rows.
- [ ] Response indicators: when a planner or a worker finishes a response Willem has not seen, a subtle indicator appears (not the dot; invent something quiet that fits the design language) with a visible distinction between planner and worker (and both), present on the chat row, the project row when collapsed, and the footer counters; opening the chat clears it.
- [ ] The border beam distinguishes who is working: a planner mid-turn reads differently from a worker mid-turn on the project row's beam (and both at once reads as both, each in its own way); invent the treatment within the design language, subtle, no labels; consistent with the response indicators' planner/worker distinction.
- [ ] Verifying jobs hold the check (extends job 3's ring work): a job whose build committed but whose verify stage is still running shows its ring fully filled with a small spinner in the center instead of the checkmark; the check (or the red X) lands only when the verify settles; jobs without a verify stage go straight to the check at commit.
- [ ] The account drawer stays open on outside click like every other footer drawer: it closes only via its taskbar icon, Escape, or another drawer opening; today it alone dismisses on click-away.
- [ ] Account switcher laid out as one list (2026-08-27): a Claude group header in the same style as the ChatGPT one (provider mark plus name), both groups sharing one row anatomy (account row, meters, resets), the ChatGPT row at the same indent and meter geometry as the Claude rows, plan tag style shared where a plan is known, Add account sitting inside the Claude group; the ChatGPT 5H row reads "no 5-hour window on this plan" in the muted meta instead of a bare dash; the drawer is meant to be left open to watch usage live, so nothing in it steals focus or collapses on its own.
- [x] (done, codex job 5) Verify-session titles: sessions spawned by the pipelined verify stage show up titled with their raw prompt ("<!-- name: Verify 02-composer.md --> You are the fresh-context verifier...") in the worker pane header and run lists; title them "Verify: <job name>" (and strip header comments from any prompt-derived title everywhere).
- [x] (moved to Job 20) Worker pane follow stability (confirmed live 2026-08-27 on the Codex chain: `WorkerPane.tsx` auto-follows the newest worker session, so the Luna verify session and the Sol build session alternate as newest and the pane flips between them, reloading the whole transcript each time): the pane follows the running chain's build session deliberately and a verify session never becomes the follow target (verify stays reachable through the jobs view's verify row); switching sessions keeps already-rendered rows where the session is the same and never replays arrival animation on rows already shown; reproduce with a stub pipelined chain and add a regression check.
- [ ] Footer counters show only active kinds, one button always: only planners active means one full-width Planner button; both kinds active means one full-width combined button (both counts on it) opening a single drawer with Planner and Worker sections clearly divided; zero of a kind shows no button or section for it; the drawer keeps its upward ramped animation.

Done check: on dev: dot's left edge equals the New session button's left edge (DOM rects); a stub worker completion shows the indicator on row, collapsed project, and counter, distinct from the planner's, cleared on open; footer renders one wide button with only a planner active and a split with both. Phone holds. Render-sanity pass. Commit.

## Job 11 — Streaming off, job tokens. Verify: yes

Goal: make completed text arrive cleanly, remove a real duplicate transcript entry at its source, and show the token cost of every dispatched job. Files: transcript streaming and rendering, transcript ingestion/deduplication, jobs history and drawer, Claude JSONL transcripts, Codex rollouts. Dependencies: none; runs last.

- [ ] Streaming text off: assistant text renders whole per block as each block arrives; the arrival fade stays, and the word-by-word stream spans go.
- [ ] Double-posted reply fixed: in the cloudcli planner session `60a700a2-9e8a-4cc8-9278-97b500aed02c`, the long assistant message beginning "Bottom line: it is not you" showed twice in the transcript on 2026-08-27. Determine whether the JSONL holds two records or the renderer draws one twice, then fix the real cause and cover it with a regression check.
- [ ] Token count per job in the jobs column: sum `message.usage` across the job's session transcript for Claude sessions; read token counts from the Codex rollout under `~/.codex/sessions` for Codex sessions; show the total as a mono figure on the job row and in the job drawer.
- [ ] New-chat orange dot gone: the indicator still shows after a reboot; remove the component entirely (there is no new-chat indicator any more).
- [ ] No streaming cursor on planner replies once streaming is off; nothing blinks after a block lands.
- [ ] Chopped and repeated text inside replies: reproduce on the planner session named above, confirm it shares the double-post root, fix at that source, and cover both symptoms with the same regression check.

Done check: on dev: assistant blocks arrive whole with the existing arrival fade and no word-stream spans; the named planner message renders exactly once after reload and its underlying record path is verified; a Claude-backed job and a Codex-backed job each show a correct mono token total on both the row and drawer, checked against their source transcript or rollout. Phone holds. Fresh-context subagent verification. Commit.

## Job 12 — Composer bottom row order (2026-08-27). Verify: yes

Goal: the composer's bottom row reads, right-aligned, in this order: handoff button, prompt history button, model switcher, context window button, send. Today the context window control sits below the composer instead of in the row. Files: the composer bottom row and the context window control, `design/composer.md`. Dependencies: none.

- [ ] Move the context window control into the bottom row between the model switcher and send, same height and icon language as its neighbors, its popover unchanged; the row below the composer disappears; both panes; phone holds.

Done check: on dev: DOM order of the bottom row's right group is handoff, history, switcher, context window, send in both panes; nothing renders below the composer; 390px holds. Commit.

## Job 13 — Live loading truth (2026-08-27). Verify: yes

Goal: nothing in the app needs a refresh to show what already happened. Files: the worker pane's context window control for Claude sessions (Codex landed in pauseresume job 2), the worker message loader and follow logic, a shared loading skeleton, `design/transcript-rows.md`, `design/motion.md`. Dependencies: none.

- [ ] Worker context window figure updates live for Claude sessions, on every turn boundary at least, without a refresh.
- [ ] Worker messages load in as they happen: no refresh and no manual scroll to the bottom to see new rows; reproduce the stale case with a running stub session and fix the actual cause (subscription, pagination window, or follow logic); regression check.
- [ ] Codex transcripts update incrementally: a rollout write appends the new rows to the rendered transcript (arrival animation on the new rows only) instead of reloading and re-animating the whole session; measured on a live Codex session: no full re-render on a rollout write.
- [ ] App-wide loading state: anything that loads in (transcript pages, jobs column, sidebar lists, drawers, settings) shows a skeleton or a blur-until-loaded treatment in the design language, ramped, reduced-motion respected; no content pops from empty; one shared primitive, appended to its design area file.

Done check: on dev: a stub running session's context figure changes without reload; new rows appear without reload or scroll; skeletons render on a throttled network (agent-browser network delay) for each surface listed and clear when data lands. Commit.

## Job 14 — One style for indicator rows (2026-08-27). Verify: no

Goal: every tool-call and status row in a transcript shares one anatomy. Files: the transcript meta-row family (bash, tool calls, research, agent, memory, watchdog, status rows), `design/transcript-rows.md`. Dependencies: none.

- [ ] Audit every indicator row kind and unify to one row anatomy (leading glyph, label, muted detail, duration slot, expand affordance) with kind-specific glyph and label only; the bash/command row stops looking different from the rest; document the anatomy once in the area file.

Done check: on dev with a synthetic transcript carrying every row kind: computed styles for padding, font, ink and radius match across kinds; one anatomy documented. Commit.

## Job 15 — Column view behaves (2026-08-27). Verify: yes

Goal: the multi-project column view stops surprising. Files: the workspace layout store and pane sizing, the jobs column open state, the column-view wiring, `design/worker-pane-and-jobs.md`. Dependencies: none.

- [ ] The jobs column opens only on the project it was opened for, never on every project at once; its open state is per project and persists.
- [ ] Opening the jobs column squishes the planner and worker panes evenly so they stay equal width; closing restores; no pane takes a random width when dragging side by side (weights and minimums reconciled per the pane-min-width lesson).
- [ ] The three-project view renders correctly: every column visible, dividers where expected, jobs takeover at 3+ per the locked jobs-surface decision, verified at 1440px and 1920px.

Done check: on dev with three projects open: jobs column toggles on one project only and survives reload; pane widths measured equal after opening the column; three-column layout snapshot matches the documented geometry. Commit.

## Job 16 — Command Center naming sweep (2026-08-27, widened). Verify: yes

Goal: nothing in the repo says CloudCLI or Claude CLI when it means this app; the product is Command Center, and identifiers that cannot carry a space are `command-center`. Files: everything in the repo (docs, CLAUDE.md, README, design/, UI copy, code identifiers, package name, env variable names, script names, comments, tests). Dependencies: none. Out of this job, deliberately: the four runtime anchors that live outside the repo and would break the running chain if moved now: the database directories `~/.cloudcli` and `~/.cloudcli-dev`, the launchd labels `com.spoton.cloudcli-*`, the config directory names, and the local folder `~/Projects/cloudcli`; those move in Job 19 after this chain ends.

- [ ] Replace every product mention: "CloudCLI", "Cloud CLI", "cloudcli" and "Claude CLI" (when it means this app, not Anthropic's `claude` binary) become "Command Center" in prose and copy and `command-center` in identifiers, env names, package name, script and file names, keys and comments; renamed env names and keys keep reading the old name for one release with a one-line deprecation log so nothing silently breaks; every renamed file keeps git history (git mv).
- [ ] Keep the runtime anchors above untouched but centralize them: one small module or config block names the DB directory, config directory and launchd label so Job 19 changes them in one place.
- [ ] The summary lists every remaining `cloudcli` string with its reason (runtime anchor only).

Done check: `grep -rni "cloudcli\|cloud cli\|claude cli"` over the repo (excluding node_modules, dist folders and .git) returns only the centralized runtime anchors listed in the summary; build, typecheck, lint and both test suites pass; dev boots and serves. Commit.

## Job 17 — Fast mode toggle for ChatGPT models (2026-08-27). Verify: yes

Goal: with a ChatGPT model selected, the model menu offers a Fast mode toggle that really switches Codex into its fast tier, with the cost stated next to it so Willem knows what he is spending. Files: the composer model menu (`ComposerModelMenu.tsx`), the per-session model and effort persistence (`sessions.model`/`sessions.effort` and the `active-*` routes), the Codex runtime provider (thread options), the per-provider defaults in the settings store, `design/composer.md`. Dependencies: none.

- [ ] Find the real mechanism first: how Codex CLI 0.147 and `@openai/codex-sdk` enable fast mode (a service tier or config key, not a model id; check `codex --help`, `codex exec --help`, the config reference and the SDK's thread options) and what OpenAI documents for its speed and usage multiplier; the worker-seat research in the memory repo recorded roughly 1.5x speed for 2.5x usage. Record the finding in the summary. If neither the CLI nor the SDK exposes it, the toggle does not ship; say so and stop.
- [ ] The toggle: when the selected model is a ChatGPT model, the menu gains one row directly under Effort: "Fast mode" with a switch and a one-line muted descriptor carrying the real figures ("1.5x speed, 2.5x usage" or whatever is documented, marked "approx." if it is not); hidden entirely for Claude models; same row anatomy as Effort. The trigger label gains a small muted "fast" tag while it is on.
- [ ] Wiring: the choice persists per session next to model and effort and applies to the next turn of an interactive session through the Codex runtime; a per-provider default lives in the settings store like `codex-effort`; dispatched jobs never use it (doctrine: Codex fast mode never for chains).

Done check: on dev: with GPT-5.6 Sol selected the row renders under Effort with the descriptor and hides on a Claude model (DOM); toggling it on and sending a turn produces a Codex request or rollout entry that shows the fast tier engaged (read it back from the rollout or SDK options log); it persists across reload and across two browser profiles; phone holds. Commit.

## Job 18 — Wakes follow the planner that dispatched (2026-08-27). Verify: yes

Goal: watchdog wakes land in the chat that owns the work, and follow it through handoffs, never in whichever planner chat Willem touched last. Files: `sessions.db.ts` (`getLatestPlannerSession` and the session row), the chain registry and `watchdog_chains` (dispatching session), the dispatch CLI and runner (announce the dispatching planner session), the handoff and rotation spawn paths in `watchdog.service.ts` (successor lineage), the wake resolver, the sidebar chat row and its menu, `design/sidebar.md`. Dependencies: none.

- [ ] A chain records the planner session that dispatched it: the dispatch CLI passes the dispatching session id (from the environment the planner runs in, or the newest planner session at dispatch time as the fallback) and the watchdog stores it on the chain; appends and amends do not change it.
- [ ] Lineage: every session spawned by handoff, rotation or dead-planner reboot records its predecessor; the wake resolver for a chain event starts at the dispatching session and follows the lineage to the live successor; a chain-end, stopped, failed or decision wake goes there and nowhere else. Wakes that belong to no chain (maintenance, self-test) go to the project's wake target below.
- [ ] Project wake target: each project has one wake target session; dispatching sets it to the dispatching session, handoff moves it to the successor, a side chat never takes it by being typed in; `getLatestPlannerSession` stops being the resolver for wakes (it may stay for boot-prologue and rotation sweeps).
- [ ] Visible and movable: the chat row that is the project's wake target carries a subtle mark in the sidebar language (muted, icon-sized, no label), and the row menu offers "Receive watchdog wakes here" to move it by hand; a wake posted to a chat shows nothing new beyond what wakes show today.

Done check: on dev: dispatch a stub chain from planner chat A, type in a new side chat B, complete the chain: the wake lands in A; hand off from A to A2, complete a second stub chain dispatched before the handoff: the wake lands in A2; move the target to B by hand and complete a chain dispatched with no session context: the wake lands in B; the mark moves with the target in the DOM; regression tests for the resolver. Commit.

## Job 19 — Runtime rename to command-center (runs after this chain, never inside it). Verify: yes

Goal: the four runtime anchors Job 16 left alone move to the new name with a migration, then the local folder renames. Files: the centralized anchor module from Job 16, `scripts/macos/*.plist.template`, `install.sh`, `promote.sh`, `dispatch`, `dispatch-chain-runner`, backup and scrub scripts, CLAUDE.md, PROJECT.md pointers in the memory repo (planner-owned, list them for the planner). Dependencies: Job 16; no chain may be running.

- [ ] Migration script: moves `~/.cloudcli` to `~/.command-center` and `~/.cloudcli-dev` to `~/.command-center-dev` (or symlinks the old to the new for one release), re-bootstraps launchd under `com.spoton.command-center-*` labels and unloads the old ones, updates every script default; idempotent; dry-run flag; logs each step.
- [ ] Local folder: `~/Projects/cloudcli` becomes `~/Projects/command-center` with the memory repo's PROJECT.md config, the Codex trust entry in `~/.codex/config.toml`, the Claude project trust entry, and the promote and dispatch defaults following; the planner's memory folder name stays `cloudcli` until the planner renames it.

Done check: after the migration on the mini: live and dev serve from the new directories under the new launchd labels, the old labels are gone, `dispatch` and `promote --tag-guard` run against the new paths, a stub chain completes, and the grep from Job 16 returns nothing. Commit.

## Job 20 — Codex transcript stability: no reloads, no bouncing (2026-08-27, runs next). Verify: yes

Goal: watching a Codex worker session is calm: rows append as they happen, nothing remounts, nothing re-animates, the scroll position never jumps. Today the worker pane visibly reloads the whole session over and over while a Codex job runs (rows re-render one by one, the view bounces up and down), even with no session switch. Files: `WorkerPane.tsx` and its follow and session-selection logic, the worker running-sessions poll, `sessions-watcher.service.ts` (what it broadcasts on a Codex rollout write), the Codex sessions provider and rollout parser (`codex-sessions.provider.ts`), the chat message loader and `MessageScroller`, `design/worker-pane-and-jobs.md`, `design/transcript-rows.md`. Dependencies: none; scheduled ahead of the remaining jobs at Willem's request.

- [x] Find the actual cause with evidence before changing anything: instrument a live Codex session on dev and record, per rollout write, what the server broadcasts, what the client refetches, whether the pane or message list remounts (React key or session id churn), whether the scroller re-pins, and whether the running-sessions poll swaps the followed session; write the finding in the summary in plain words.
- [x] Fix at the source: a rollout write results in the new rows being appended to the rendered transcript (arrival animation on those rows only); no full refetch, no remount, no re-animation of existing rows; the scroller keeps its position unless the user is at the bottom, in which case it follows smoothly.
- [x] Follow stability moves here from Job 10: the pane follows the running chain's build session deliberately; a verify session never becomes the follow target (reachable from the jobs column's verify row); switching sessions on purpose keeps rendered rows where the session is unchanged.
- [x] Same treatment holds for Claude sessions (no regression in the JSONL path), verified with a synthetic transcript appended live.

Done check: on dev with a real Codex session running (a `codex exec` one-liner in `~/Projects/codex-smoke` is enough): over two minutes of rollout writes the pane's message list element identity never changes (DOM node identity or a mount counter), no row animates twice, the scroll offset stays put when scrolled up and follows when at the bottom; a stub pipelined chain shows the pane staying on the build session while a verify session exists; regression tests. Commit.

## Job 21 — Composer stays silent on auto-sent text (2026-08-27, Willem). Verify: yes

Goal: Willem never sees a message being typed for him. Today a slash command (typed, from the plus menu, or the Handoff button) and a planner boot both write their expanded body into the composer textarea and submit on the next tick, so the prompt box visibly fills with the whole command or boot text before it sends. He wants none of that: the composer shows only what he typed himself. Files: `src/components/chat/hooks/useChatComposerState.ts` (the command execution path that calls `setInput` with the built command message and defers submit, `executeCommand`, the boot effect and `handleSubmit`), `src/components/chat/view/subcomponents/ChatComposer.tsx`, and any other caller that fills the input to send.

- [x] Slash commands submit their expanded body directly through the send path without ever writing it to the composer's input state or textarea; the input keeps whatever the user had (empty after a typed command, untouched in the preserve-input case).
- [x] The planner boot and the Handoff button's /handoff go the same way: nothing appears in the composer at any frame; the composer lock while booting stays as it is.
- [x] The transcript still renders the compact command bubble and the boot behaves exactly as before (placeholder title, boot flag, hidden prologue).
- [x] A regression test on the hook covers the submit path: a command execution never sets the input value.

Done check: on dev with agent-browser, poll the composer textarea value every animation frame (a small eval loop collecting values) while a fresh planner boot fires and while a slash command fires from the plus menu; the collected values never contain the command or boot text; the transcript shows the command bubble and the boot completes as before; tests pass. Commit.

## Job 22 — Thinking grid: glitches fixed, a pattern vocabulary (2026-08-27, Willem). Verify: no

Goal: the 3x3 pixel grid beside the status word is the one animation Willem watches most, and on the planner pane it misbehaves: the middle row of dots (and sometimes squares) sits a hair higher than the outer rows, and patterns show up that are none of the three designed ones (drive, dots, orbit), which he likes. He wants the glitches gone and the vocabulary grown: more named states in the Claude CLI register (Discombobulating, Percolating and friends), each bound to its own symmetric pattern that moves and fades like the existing ones. Files: `src/shared/view/beui/PixelLoader.tsx`, `src/components/chat/view/subcomponents/ActivityIndicator.tsx`, the `bui-pixel-on` keyframes and `bui-pixel-cell` rule in `src/index.css`, `design/transcript-rows.md` and `design/motion.md`.

- [ ] Alignment check (Willem says it looks fine now; confirm rather than assume): measure the nine cells' bounding boxes per row and column on dev at device pixel ratio 1 and 2, round and square cells alike; if any row or column is off by more than 0.1px, fix it with whole-pixel geometry (4px cells with a 1.5px gap is the suspect); if it is already clean, note the measurement in the summary and move on.
- [ ] Stray-pattern check, same spirit: over one long planner turn record which patterns render; if anything outside the catalog appears or two loaders ever coexist, fix it at the cause (rotation index jumping on a server status override, the elapsed counter restarting on an activity change, exit and enter indicators overlapping); if it is clean, say so and move on.
- [ ] Pattern catalog: keep drive, dots and orbit; add at least seven more, each symmetric or with one clear axis, built on the same fade (ease-in-out on, dim resting state, the wavefront feel): for example pulse (center outward ripple), scan (row sweep down then up), spiral (inward), diagonal (corner to corner), breathe (whole grid in phase), checker (alternating cells), rain (columns falling), converge (corners to center). Each pattern has a name.
- [ ] Word and pattern pairs: at least ten status words in the Claude CLI register (Thinking, Working, Churning, Discombobulating, Percolating, Marinating, Noodling, Cogitating, Ruminating, Tinkering, Mulling, Brewing), each bound to one pattern; rotation picks the next pair at random without repeating the last two, the word and grid change together, and the swap cross-fades over a ramped curve rather than snapping. A server status line overriding the word keeps the current pattern until the next rotation.
- [ ] Reduced motion still freezes the grid at rest; the catalog (pattern name, shape, bound word) is documented in `design/transcript-rows.md` and the motion rule in `design/motion.md`.

Done check: on dev with agent-browser, for every catalog variant rendered in a fixture, the nine cells' rects show one y per row and one x per column within 0.1px at ratio 1 and 2; during a deterministic 70-second planner turn (the lessons folder has the recipe: a foreground node setTimeout) the observed word and pattern sequence contains only catalog pairs, no two loaders coexist in the DOM, and each swap is a cross-fade (opacity sampled mid-swap is between the two states); tests for the rotation picker. Commit.
