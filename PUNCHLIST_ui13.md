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

- [ ] Job-level icons go monochromatic: a completed job's checkmark is white/ink (no green at the job row level); the job ring keeps its segment fills but in the monochromatic treatment. Task-level check icons stay green and each job's done/total counter stays green; document the split (jobs mono, tasks semantic) in DESIGN.md.
- [ ] Collapsed sidebar is a compact rail: a vertical list of the run's job rings, one per job, each ring carrying its own compact "n/N" count inside, statuses readable (done, working with the ramped spinner, idle) at rail size. Clicking a ring expands the sidebar with that job's drawer open and scrolled into view.

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
