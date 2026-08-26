# PUNCHLIST_ui13 — jobs sidebar refinement: mono job icons, compact rail, jobs as navigation, marquee, tooltip purge

## Goal

Willem's refinement round on the ui12 jobs sidebar. Job-level iconography goes monochromatic while task-level keeps semantic green, the collapsed sidebar becomes a compact rail of count rings, job rows become the way to navigate between run chats (retiring the top dropdown), truncated titles get back the rolling hover scan, and redundant tooltips go away. Dev-first, end-to-end verification, promote without an eyeball gate; Willem reviews live.

## Stack and decisions already made

- Held for Willem's call, do NOT build: the worker pane top bar's "Job 11 of 11" text and the right-side aggregate counter treatment. Leave both as they are; the planner will fold the decision in as a task or append.
- Standing laws: drawers/sheets not centered popups; semantic status colors at task level; DESIGN.md consistency; mobile parity tap-first; no em dashes in UI copy.
- Rebuild discipline: rebuild and restart dev only when the done check needs the running instance to show the change; run tests without a rebuild where they suffice; never rebuild twice when once serves.

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to DESIGN.md. Match colors, spacing, fonts, corners, shadows.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Keep each job under 5 concurrent subagents. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 1 — Jobs sidebar: monochromatic job level, compact collapsed rail

Goal: the job rows read monochromatic while their tasks keep semantic color, and the collapsed sidebar still tells the story. Files: the jobs sidebar components from ui12 phase 5/job 8, the status icon components, DESIGN.md. Dependencies: none.

- [x] Job-level icons go monochromatic: a completed job's checkmark is white/ink (no green at the job row level); the job ring keeps its segment fills but in the monochromatic treatment. Task-level check icons stay green and each job's done/total counter stays green; document the split (jobs mono, tasks semantic) in DESIGN.md.
- [x] Collapsed sidebar is a compact rail: a vertical list of the run's job rings, one per job, each ring carrying its own compact "n/N" count inside, statuses readable (done, working with the ramped spinner, idle) at rail size. Clicking a ring expands the sidebar with that job's drawer open and scrolled into view.

Done check: on dev with a stub chain and the ui12 history: computed color of a completed job's check is the ink token (not green) while its tasks' checks are green and the counter green; collapsing the sidebar shows one ring per job with the n/N count rendered inside; clicking the second ring expands the sidebar with job 2's drawer open. Phone viewport holds. Fresh-context subagent verification. Commit.

## Job 2 — Jobs are the navigation

Goal: the jobs sidebar replaces the worker pane's top dropdown as the way to reach a run's chats. Files: the jobs sidebar row components, the worker pane header (the run switcher dropdown), routing/session-select paths, DESIGN.md. Dependencies: job 1 (row anatomy settles).

- [ ] Hovering a job row swaps the right-side chevron for a chat icon; clicking it (or the row body) navigates the worker pane to that job's session transcript; clicking the job's title toggles its task drawer instead of navigating. Touch: tap the row navigates, tap the title toggles, consistent with tap-first law.
- [ ] The top-of-pane run-switcher dropdown is retired: run selection happens through the jobs sidebar (and the existing worker counter drawer for cross-run jumps); whatever unique function the dropdown still carried (e.g. jumping to another run's chain) moves into the sidebar or counter drawer rather than being lost — inventory its functions first and state the mapping in the summary.
- [ ] The active job's row indicates which session the pane is showing (subtle, monochromatic, not a tag chip).

Done check: on dev with a completed multi-job run: hovering row 3 shows the chat icon; clicking navigates the pane to job 3's session (URL/pane header match); clicking the title only toggles the drawer; the dropdown is absent from the header DOM and each of its inventoried functions is reachable through the sidebar or counter drawer. Phone viewport holds. Fresh-context subagent verification. Commit.

## Job 3 — Rolling title scan returns, tooltips get purged

Goal: truncated titles reveal themselves on hover again, everywhere, and tooltips only exist where a control does not explain itself. Files: the marquee/scan text component from the pre-ui12 sidebar (find it in git history if deleted), ChatRow, the jobs sidebar rows, the tooltip call sites app-wide, DESIGN.md. Dependencies: job 1.

- [ ] The rolling hover scan (the marquee that scrolls a truncated title so the whole thing can be read) is restored on sidebar chat rows and applied to job rows in the jobs sidebar; fine-pointer hover only, with a coarse-pointer equivalent already sanctioned by the app's laws (or none, if the full title is reachable another way on touch; state the choice).
- [ ] Tooltip purge: inventory every tooltip call site; keep tooltips only on icon-only controls whose purpose is not self-evident; remove them from chat rows, titles, and anything whose visible text already says what it is. List kept and removed sites in the summary.

Done check: on dev, a long-titled chat row and a long-titled job row both scroll their text on hover (computed animation running) and rest truncated otherwise; removed tooltip sites show no tooltip content in the DOM on hover; kept sites (icon-only controls) still show theirs. Phone viewport holds. Fresh-context subagent verification. Commit.

## Job 4 — Footer taskbar and integrated drawers (appended 2026-08-25)

Goal: the sidebar footer becomes one icon taskbar and the mini drawers stop feeling like separate popouts. Files: the sidebar footer (Memory/account/Settings rows), SidebarFooterDrawer and AccountsPanel, DESIGN.md. Dependencies: none.

- [ ] The stacked footer buttons become a single bottom taskbar of icon-only controls, left-aligned, no labels: Settings, account, Memory. The open drawer's icon reads selected; the others dim. 44px touch targets.
- [ ] The footer drawers (account switcher, memory) lose the separate gray popout look: same background as the sidebar, integrated with the existing divider line, and opening pushes the content above up naturally (the taskbar stays put at the bottom) instead of overlaying with their own panel chrome.
- [ ] Fix the close glitch: today the drawer stops descending with a visible sliver before the element unmounts. Close animates fully out with a ramped ease, no terminal jump, no leftover sliver; open gets the same ramp treatment.
- [ ] Account switcher copy: drop the "Claude accounts" heading; verify what a cswap switch actually does to running sessions (read the accounts module and cswap wiring) and remove the "Switching applies to new sessions" subtitle, replacing it with nothing, or with one short true line only if running sessions genuinely keep the old account.

Done check: on dev, DOM: footer is one icon row, opening the account drawer pushes the list content up with the sidebar's own background (no distinct panel bg token), close runs to fully offscreen before unmount (transition end position beyond the container), heading and stale subtitle absent; phone viewport holds. Fresh-context subagent verification. Commit.

## Job 5 — Full-sidebar settings and memory, icon tabs (appended 2026-08-25)

Goal: Settings stops being a popup and the top tabs become icons. Files: the settings modal, the memory viewer surface, the sidebar tab strip, DESIGN.md. Dependencies: job 4 (taskbar exists).

- [ ] Settings opens as a slide-up surface that fills the entire sidebar (not a centered popup, not a floating panel): same background, ramped slide, closed by its taskbar icon or Escape. All settings content lives inside it, reflowed for the sidebar width.
- [ ] Memory opens the same way, filling the sidebar.
- [ ] The Projects / Chats / Archive text tabs become left-aligned icon tabs: folder, chat bubble, and an archive box icon, same selected treatment as today, tooltips allowed (icon-only controls per the ui13 tooltip rule).

Done check: on dev: opening Settings fills the sidebar with a slide-up (DOM: occupies the sidebar container, no dialog overlay), memory the same, tab strip renders three icons left-aligned with correct selection; phone holds. Fresh-context subagent verification. Commit.

## Job 6 — Images in and out of the chat (appended 2026-08-25)

Goal: image previews zoom on every device, and sessions can send images back so Willem can preview icons and mockups inline. Take time here; this integrates deeply with the chat. Files: the image preview overlay, the message renderer, the attachments/assets pipeline (server asset serving for session-produced files), DESIGN.md. Dependencies: none.

- [ ] Image previews zoom: scroll/double-click zoom and drag-pan on desktop, pinch-to-zoom and pan on mobile (touch-action handled deliberately), with a reset control; works for attachment previews and any inline image.
- [ ] Sessions send images: when a planner or worker turn references an image file it produced or edited in the workspace (icon SVG renders, screenshots, mockups), the transcript renders it inline as an image card (fit-contained, bordered per the composer thumbnail language, click opens the zoomable preview). Serve workspace image paths through an authenticated asset route scoped to the project; SVG and the common raster formats covered.
- [ ] The mechanism is honest and simple for the model side: document in CLAUDE.md how a session shows an image (e.g. a line or fenced marker carrying the file path), so planners and workers can use it deliberately; render only files that exist inside the project or session workspace, never arbitrary paths outside them.

Done check: on dev: an attachment preview zooms and pans with mouse and with touch emulation; a test worker message referencing a repo SVG and a PNG renders both inline and each opens in the zoom preview; a path outside the workspace does not render. Fresh-context subagent verification. Commit.

## Job 7 — Active segment glow and the ramp pass (appended 2026-08-25)

Goal: the working task's ring segment glows, and every drawer animation in the app gets ramp thinking. Files: the job ring components, drawer/sheet transition definitions, motion tokens, DESIGN.md. Dependencies: none (job 1's mono treatment already landed).

- [ ] On the active job's segmented ring, the segment corresponding to the task currently being worked pulses with a white glow, coordinated with the existing breathing (same beat or a deliberate offset — worker's call, pick what feels best and note it); completed jobs go solid, no breathing, no glow.
- [ ] Ramp pass over the app's drawers and sheets (footer drawers, jobs sidebar, account/counter drawers, bottom sheets): eased, ramped curves in and out, no linear or abrupt endings; write the ramp principle into DESIGN.md's motion section as a standing law for future animation work.

Done check: on dev with a stub chain: the working segment's computed style animates (glow keyframes running) while other segments do not, completed rings are static; drawer open/close computed transition-timing-functions are the ramped curves from DESIGN.md, not linear; reduced-motion honored. Fresh-context subagent verification. Commit.

## Job 8 — Memory that reads like Claude's (appended 2026-08-25)

Goal: the memory surface shows Willem his memory, not the plumbing, and it behaves like the Claude app's self-maintaining memory. Files: the memory indicator row, the memory viewer, plus a curated memory file contract (planner/_global/WILLEM.md in the spoton-worker repo — the planner owns its content; this job builds the surfaces). Dependencies: none.

- [ ] The "Memory updated" indicator row matches the transcript's meta-row anatomy exactly (the "Thought for a few seconds" row family): same icon slot, size, alignment, text style, expand behavior; correct memory icon.
- [ ] The memory viewer's primary view is the curated memory: planner/_global/WILLEM.md, a single self-maintained document of things Willem said, his preferences, and how he likes to work — rendered cleanly, most recent changes visible. The technical layers (lessons, PROJECT.md, STATE.md, sessions) move to a secondary "internals" view. The Global/project split stays underneath.
- [ ] Editing follows the Claude model, not the ChatGPT chip model: Willem edits by telling the planner (the viewer has no delete-x chips), and the file carries a short header line saying so. Create the file with a seed section if the planner has not yet (check first; the planner may have committed it already).
- [ ] End-to-end test of the whole memory surface: indicator fires on a real write, viewer opens from the taskbar, primary view renders WILLEM.md, internals view still reachable.

Done check: on dev: the indicator row's computed styles match the thought-row family (side-by-side DOM comparison); the viewer defaults to the curated view rendering WILLEM.md; internals reachable; end-to-end pass recorded. Fresh-context subagent verification. Commit.

## Job 9 — Mobile mirrors desktop (appended 2026-08-25)

Goal: mobile is the same product, sized for a phone. Files: mobile-specific sidebar and pane chrome, the mobile tools menu, DESIGN.md. Dependencies: jobs 4-5 (the new sidebar chrome exists to mirror).

- [ ] Remove the leftover quick-settings button on the right edge of mobile; the sidebar's bottom padding shrinks so the footer taskbar sits at the natural bottom (safe-area padded, not floating high).
- [ ] The mobile sidebar mirrors the desktop structure exactly (icon tabs, taskbar, drawers as sheets), sized per the mobile laws; kill any mobile-only variants that drifted (Willem will screenshot remaining nits next round).
- [ ] Planner and worker panes on mobile get a top-bar toggle between chat and shell/terminal views; the current mobile shell view stops showing an unrelated session and binds to the pane's own session; the stale files/source-control entries leave this menu (they become windows in job 10).

Done check: on dev at 390x844: no quick-settings button in the DOM, footer taskbar within the safe-area bottom, tab icons and drawers match desktop structure, the chat/shell toggle switches views on both panes and the shell shows the pane's session cwd. Fresh-context subagent verification. Commit.

## Job 10 — Windows (appended 2026-08-25)

Goal: files and source control become windows in a real windowing layer that extends the existing pane-stacking system, so any auxiliary surface can open, close, and tile without freeform floating. Files: the workspace pane layout (the planner/worker stacking and thin collapsed rails), a window registry/selector, the files and source-control surfaces, DESIGN.md. Dependencies: job 9. This is the heaviest job; take the space it needs.

- [ ] A windowing layer over the workspace: windows open side-by-side or stacked within the existing grid (no freeform floating, no z-order layering), resize via the existing drag handles, close to nothing or collapse to the thin rotated-text rail exactly like planner/worker panes do; when a pane closes, its rail attaches to the nearest open pane of that project, squishing it, consistent with the current multi-project stacking behavior.
- [ ] Files and source control move out of the old menu into windows; a window selector (a control in the workspace chrome listing available windows per project: Planner, Worker, Files, Source Control, extensible) opens and closes them; neither is open by default.
- [ ] The selector and rails tie into the project stacking system end to end: multiple projects open, each with its own window set, collapse/attach behavior verified across project switches and reloads.

Done check: on dev: opening Files and Source Control from the selector tiles them into the grid with working resize; closing collapses to rails that attach to the project's open pane; two projects with different window sets survive switching and reload; mobile presents windows as full-pane views behind the same selector. Fresh-context subagent verification. Commit.

