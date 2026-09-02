# PUNCHLIST_ui19 — green suite, Fable 5.1, mobile context truth (2026-08-29)

## Goal

Three things Willem needs: the server test suite is red at HEAD which blocks every promote; Fable 5.1 shipped and replaces Fable 5 as the Claude default with a model list that updates itself; the phone shows 0 for context on sessions that are clearly not at 0.

## Stack and decisions already made

- Verifier scope per doctrine: "Verify: yes" runs the runner's verify stage; "Verify: no" leaves Willem's eye as the reviewer.
- Standing laws: personal-tool wording, drawers not popups, ramped motion, DESIGN.md consistency, mobile parity, no em dashes in UI copy, pathspec commits for planner files.

## Whole-file rules

- Read DESIGN.md before UI work; reuse the closest existing element; update the matching design area file when implementation changes a documented pattern.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit each job, push at job end, check items off in this file the moment each is verified, in the same commit as the work. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results; UI verification via agent-browser DOM/snapshot on dev (port 4748, config dir ~/.claude-dev, DB ~/.cloudcli-dev/auth.db); confirm visible changes at a phone viewport.
- Run rules: Codex's computer-use tool is not installed here, never attempt it; do not spawn subagents. Group related shell work into one call, read files with the Read tool in the ranges you need, do not narrate between tool calls. On unrecoverable failure stop and state what blocks.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 0: The server suite is green again (2026-08-29). Verify: yes

Goal: four server tests fail at HEAD (`hold-at-boundary`, `pause-during-verify`, the all-dry chain recovery case, and the anchor-less planner manifest case; ui18 unit 1's journal called three of them pre-existing and later units confirmed a fourth), and promote.sh runs the full server suite, so a red tree blocks every promote. Fix the tests at the cause: if the code is wrong the code changes, if the test asserts a stale contract the test changes to the real contract, and the summary says which it was per test, with evidence. Files: `server/modules/watchdog/tests/` (the failing files), whatever code they exercise, nothing else.

- [ ] All four named tests pass individually and in the full suite, with the cause of each stated in the summary (code defect or stale assertion), never skipped, never loosened to pass.
- [ ] The full server suite and client suite pass twice in a row from a clean state (no order dependence, no leaked fixtures from the manifest and hold tests that mutated HOME and env in ui18).

Done check: two consecutive full-suite runs pass from a clean tree; the summary names each test's cause. Commit.

## Job 1: Fable 5.1 is the Claude default, and the model list updates itself (2026-08-29, Willem). Verify: yes

Goal: Anthropic shipped Claude Fable 5.1, model id `claude-fable-5-1`, confirmed served on this machine (CLI 2.1.258 recognizes it; a headless probe returned modelUsage keyed `claude-fable-5-1`). Willem wants it to replace Fable 5, and he never wants to wait for a code change to see a new model again: the switcher's Claude list should follow what the installed CLI supports. Files: `server/modules/providers/list/claude/claude-models.provider.ts` (hardcoded list, `DEFAULT`, the context-window map), `server/modules/settings/settings.service.ts` (planner and worker session defaults), `src/components/chat/hooks/useChatProviderState.ts`, the cursor and opencode provider lists, `server/modules/agent/agent.routes.ts` docs line, tests.

- [ ] The Claude model catalog is sourced from the installed CLI at runtime rather than a hardcoded array: find what the CLI or its SDK exposes (a models listing, the SDK's known-model data, or a cheap probe path) and read it at server start and on a settings refresh, falling back to the current static list only when the source is unavailable; the summary states exactly which source was used and why. After a `claude update` introduces a new model, the switcher shows it after a server restart or refresh with no code change.
- [ ] `claude-fable-5-1` (label Claude Fable 5.1) replaces `claude-fable-5` as the Claude default everywhere a default lives: the provider `DEFAULT`, the new planner and worker session defaults in `settings.service.ts`, the client-side fallback in `useChatProviderState.ts`; Fable 5 stays selectable in the list; the context-window map carries 1,000,000 for `claude-fable-5-1`.
- [ ] Sessions already running keep their model; only new sessions pick up the new default; the account switcher's Fable meter keeps working (its label reads the Fable family, not one id).

Done check: on dev, the model switcher lists Claude Fable 5.1 and marks it default for a fresh session; a fresh planner-origin session row records model `claude-fable-5-1`; the catalog source is live (demonstrated by the summary's evidence, e.g. removing a model from the static fallback changes nothing while the CLI source is present); tests pass. Commit.

## Job 2: The phone shows the real context figure (2026-08-29, Willem: it says 0 on mobile). Verify: no

Goal: on the phone the context indicator reads 0 for sessions that are far from 0 (Willem, 2026-08-29, mobile). Reproduce first at a phone viewport with a session that has real usage (the dev fixture or a copied live session), find why the phone reads 0 while desktop reads the true figure (a different store path, a compact formatter truncating, or the mobile footer never receiving the usage payload), and fix it at the cause so phone and desktop always show the same number from the same source. Files: the context window control and usage footer components in `src/components/chat/`, `src/components/worker-pane/`, the token-usage service route, `design/composer.md`.

- [ ] At 390px the context indicator for a session with known usage shows the same figure as the desktop layout, live and after a cold reload, on the planner and worker panes; the cause is stated in the summary with the evidence.
- [ ] A regression test covers the phone layout reading the same usage source as desktop.

Done check: on dev with agent-browser at 390px on the fixture session, the indicator shows the known non-zero figure matching desktop; tests pass. Commit.
