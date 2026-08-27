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
- Keep each job under 5 concurrent subagents. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

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

Done check: on dev with stub history spanning two months: indent reduced, sidebar wider with no clipped titles, hover shows durations, running task ticks live, no green text (computed styles), failed task red with reason in the footer, month rows with counts render and group correctly under stubbed dates. Phone holds. Fresh-context subagent verification. Commit.

## Job 4 — Memory surface: the diff preview for real, padding, copy. Verify: yes

Goal: the memory row finally shows what changed, and the memory popout's prompt bar sits right. Files: the memory indicator row and its expansion, the memory popout, DESIGN.md. Dependencies: none.

- [ ] Second report: expanding a memory-updated row still shows only the file name. ui14 job 3 claimed a diff preview; reproduce on live surfaces, find why it does not render (data not sent, renderer path, or the expansion showing the wrong slot), and fix so the expansion lists the actual changed lines (compact, changes only, never the whole file), next to or under the file name. Regression test.
- [ ] Watchdog messages stop looking like Willem's: turns originating from the watchdog (wakes, rotation prompts, chain events) render as a distinct system row instead of a user message bubble — the meta-row family's language (leading icon, muted treatment, compact one-line summary, expandable to the full text), visually unmistakable as machine-to-planner; creative freedom on the exact form within the row anatomy. Applies live and on reload; detection keyed on the message's origin, not text matching.
- [ ] Interrupted tells the truth: Willem sees an "Interrupted" row while an Agent chip above it still spins — reconcile row state with turn state so an interrupted turn stops every running indicator in that turn (agent chips included), the Interrupted marker renders only for genuinely killed turns, and nothing animates after it; if the marker cannot be made truthful for a case, it does not render for that case.
- [ ] Memory popout: the padding above its prompt bar equals the padding below it; the placeholder reads "Iterate memory..." (he removes more than he adds; never "Remember that").

Done check: on dev: a real memory write's row expands to the changed lines; popout paddings measure equal; placeholder text correct. Phone holds. Fresh-context subagent verification. Commit.

## Job 5 — Settings: System tab, sounds, and the missing obvious. Verify: yes

Goal: settings grow up: a System tab first, sound choices per pane, and the obviously missing configuration added. Files: the settings surface, notification/sound wiring, DESIGN.md. Dependencies: none.

- [ ] A System tab, first in the tab order: planner auto-rotation moves here from Notifications, alongside the genuinely systemic settings (rotation threshold, anything server-behavior shaped that currently hides elsewhere or nowhere).
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
- [ ] The thresholds live in the new System tab (job 5's settings store) with sane defaults as above.

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
- [ ] Duplicate job detection: when a job is re-run (a resume chain after a limit kill or failure) and completes, the earlier failed or stopped record of the same job is superseded — hidden from the history list (kept in the DB, not shown) so it never reads as a real failure. Match by an explicit `<!-- supersedes: <slug>/<job number> -->` header on the resume prompt file when present (the planner adds it), else by identical punch list file plus job section; apply retroactively to existing records (the ui13/ui13r column-view pair, the ui11/ui11r pair).
- [ ] Footer counters show only active kinds, one button always: only planners active means one full-width Planner button; both kinds active means one full-width combined button (both counts on it) opening a single drawer with Planner and Worker sections clearly divided; zero of a kind shows no button or section for it; the drawer keeps its upward ramped animation.

Done check: on dev: dot's left edge equals the New session button's left edge (DOM rects); a stub worker completion shows the indicator on row, collapsed project, and counter, distinct from the planner's, cleared on open; footer renders one wide button with only a planner active and a split with both. Phone holds. Render-sanity pass. Commit.

