# PUNCHLIST_ui18 — promote timing, the promoted divider, icon variations (2026-08-29)

## Goal

Willem's asks after the ui17 promote: a promote must let the running job finish instead of parking it mid-work; the jobs column shows when each promote landed; ten icon variations on the twisted-hoop mark for him to pick from. Dev-first, end-to-end verification, promote without an eyeball gate.

## Stack and decisions already made

- Verifier scope per doctrine: each job carries "Verify: yes" (the runner's verify stage) or "Verify: no" (Willem's eye is the reviewer).
- Standing laws: personal-tool wording, drawers not popups, ramped motion, monochromatic with semantic status color, DESIGN.md consistency, mobile parity, no em dashes in UI copy, label caps, rebuild discipline, pathspec commits for any planner files.

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; new elements get appended to the matching design area file.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file the moment each is verified, in the same commit as the work. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev; confirm visible changes at a phone viewport.
- Run rules: browser and UI checks use agent-browser against dev (port 4748, config dir ~/.claude-dev, DB ~/.cloudcli-dev/auth.db); Codex's computer-use tool is not installed here, never attempt it; do not spawn subagents. Group related shell work into one call rather than many small ones, read files with the Read tool in the ranges you need, and do not narrate between tool calls. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0: A promote lets the running job finish (2026-08-29, Willem: jobs should finish before that happens). Verify: yes

Goal: since ui17 Job 18, promote.sh pauses every running chain through `dispatch pause`, which stops the runner and the unit mid-work and parks the WIP; several "failed" jobs Willem saw were exactly that. A promote should hold at the next unit boundary instead: let the running build commit, let its verify settle, then pause there. Files: `scripts/macos/promote.sh` (the pause step), `scripts/macos/dispatch-chain-runner` (unit boundary, the reload point from ui17 Job 22), `scripts/macos/dispatch` (a `hold` subcommand or flag), the watchdog chain routes and records, tests, `design/worker-pane-and-jobs.md`.

- [ ] Promote asks each running chain to hold rather than pausing it: a hold flag on the chain record (set through a dispatch subcommand the way pause is) that the runner reads at its unit boundary, after the commit gate and after that unit's verify has settled; the runner pauses itself there (same parked-clean state as `dispatch pause` on a clean tree, nothing parked mid-work), journals `HH:MM | run | HELD | promote`, and promote proceeds only once every chain reports held.
- [ ] Bounded: a chain that has not reached its boundary within the drain budget (30 minutes, the existing `PROMOTE_DRAIN_BUDGET_S`) makes promote clear the hold, fire the decision-needed notice, and abort without touching live; nothing is ever parked mid-unit by a promote.
- [ ] Resume is unchanged: after the post-promote health check (or a rollback) every held chain resumes from its next unit; the jobs column shows the chain as "holding for promote" between the boundary and the resume, using the existing paused treatment plus that label.
- [ ] Every completed promote is recorded by the watchdog in one row (time, the promoted commit, the previous live commit, dry-run flag) in a `promotes` table, exposed on the watchdog routes, so the jobs column can draw it (Job 1); the record is written from promote.sh through the notify path, never by hand.

Done check: on dev with the stub chain mid-unit, a dry-run promote (ui17 Job 18's flag) waits for that unit's commit and verify, journals HELD, proceeds, and the chain resumes at the next unit with nothing parked; a stub unit that never reaches its boundary within a 20-second test budget makes the dry run abort with the notice and the chain keeps running; a completed dry run writes a promotes row; tests pass. Commit.

## Job 1: A promoted line in the jobs column (2026-08-29, Willem). Verify: no

Goal: Willem wants to see exactly when things went live: a thin divider between jobs in the history at the point a promote landed, with "Promoted" on the left and the date and time on the right, so he can tell which jobs are on live and which are not. Files: `src/components/worker-pane/JobsSidebar.tsx` (the history list and its period grouping), the watchdog promotes feed from Job 0, `design/worker-pane-and-jobs.md`.

- [ ] A promote row: one hairline in the border color spanning the list width, a small mono muted "Promoted" label on the left and the promote's time on the right (the app's own time format for the row, a full date and time on hover), sitting between the last unit that landed before the promote and the first unit after it; it is not a job, has no ring, no chevron, no click, and never counts in any job total.
- [ ] Rows come from the promotes feed live (a promote landing while the column is open inserts the row with the list's existing ramped entry motion); history pages that load later include theirs; before the first recorded promote nothing is drawn, no backfill and no guessing from tags.
- [ ] Both column modes (side column and full-pane takeover), phone parity; `design/worker-pane-and-jobs.md` documents the row.

Done check: on dev with the stub chain and two stub promotes rows, the column shows two promote rows at the right positions with the label and time, no ring or chevron, and a third stub promote appearing live inserts a row with the entry motion; 390px holds; tests pass. Commit.

## Job 2: Ten icon variations on the twisted hoop (2026-08-29, Willem). Verify: no

Goal: the current Command Center mark (`public/mark.svg`, `favicon.svg`, the PNG sizes) reads fine but is not what Willem pictures. He wants ten variations to pick from, leaning abstract, floating on a transparent background. The seed image in his words: take a hula hoop, grab it by both sides and twist so the top and bottom lines cross; you get something like an infinity symbol where one lobe is heavier than the other. Files: new folder `assets/icon-variants/` (SVG sources plus one contact sheet), nothing in `public/` changes, no app wiring; `design/tokens.md` gains nothing until he picks.

- [ ] Ten SVG variants at `assets/icon-variants/01-<name>.svg` to `10-<name>.svg`, each 512 by 512 with a transparent background, single monochrome ink that works on the app's light and dark surfaces (currentColor), built as clean paths (no raster, no filters, no gradients): four close to the twisted hoop (weight and lobe balance variations, open or closed stroke ends), three abstract derivatives (one continuous stroke with a gap, a partial hoop with the crossing implied, the two lobes as overlapping arcs), three on the nose for a command center (the hoop around a center point, an orbit with a core, a ring with a single bar), each with a one-line rationale in a `README.md` in the folder.
- [ ] A contact sheet `assets/icon-variants/sheet.png` rendering all ten at 180px and 60px on both a light and a dark tile, so the phone reading is visible at a glance; note in the README which ones lose the crossing at 60px.
- [ ] Show the work in your own chat, not in the app: after committing, write one markdown image line per variant (`![01 name](assets/icon-variants/01-name.svg)`) plus the sheet, then end with the plain list of filenames and rationales so Willem can name the one he wants. Nothing is wired into the app, the favicon, or the manifest.

Done check: ten SVGs and the sheet exist under `assets/icon-variants/`, each SVG parses and has no fill or stroke color other than currentColor, the README lists all ten with rationales, the images render inline in your chat. Commit.
