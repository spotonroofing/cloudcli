# PUNCHLIST_pauseresume — dispatch pause and resume (first real Codex job)

## Goal

The planner today pauses a chain by killing its runner and resumes it as a fresh `<slug>r` chain, which is how duplicate jobs were born. `dispatch pause` and `dispatch resume` make it one chain record: pause stops the runner and its phase cleanly, resume restarts from the first unfinished job. This is also the first real dispatched job on Codex GPT-5.6 Sol with the Luna verify stage; the planner reads its tokens and minutes against the Claude baseline afterwards. Dev-first (port 4748), end-to-end verification.

## Whole-file rules

- Read the files the job names before editing; never speculate about code you have not opened. Read `design/worker-pane-and-jobs.md` before touching the jobs column.
- Ensure `.gitignore` excludes `.env` before any `git add`. Commit the job, push at job end, check items off in this file in the same commit. Trust repo state over the phase prompt when they disagree.
- Progress honesty: claims check against tool results. Keep the change minimal; the runner is a zsh script and the watchdog a TypeScript module, both already carry the patterns you need (journal lines, chain events, park branch).
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

---

## Job 1 — dispatch pause and dispatch resume. Verify: yes

Goal: one chain record survives a pause. Files: `scripts/macos/dispatch`, `scripts/macos/dispatch-chain-runner`, `server/modules/watchdog/watchdog.routes.ts`, `watchdog.service.ts`, the chain snapshot the jobs column reads, `design/worker-pane-and-jobs.md`. Dependencies: none.

- [x] `dispatch pause <project> <slug>`: the runner and its running build or verify session end cleanly (a signal the runner traps, not a blind kill), the phase's uncommitted work is parked the way the runner already parks it, the journal gets a `PAUSED` line, the watchdog marks the chain `paused` (a chain event, not a direct database edit), and the jobs column shows the chain and its current job as paused. Pausing a chain that is not running says so and changes nothing.
- [x] `dispatch resume <project> <slug>`: a new runner starts on the same chain record from the first job that has no completed commit, restoring parked work first; the chain returns to `running`, the job count and manifest are unchanged, no new slug and no duplicate job rows; the chain-end wake fires once, at the true end. Resuming a chain that is not paused says so and changes nothing.
- [x] The runner's own signal handling: on the pause signal it posts the paused event before exiting; a runner that dies without a signal (crash, reboot) is still caught by the liveness sweep as today.

Done check: on dev (`DISPATCH_SERVER_URL=http://127.0.0.1:4748`, `DISPATCH_DB_PATH=$HOME/.cloudcli-dev/auth.db`), using the stub-chain recipe (a `claude` shim on PATH that sleeps and commits, `DISPATCH_VERIFY_ENGINE=claude`): a three-unit stub chain paused during unit 2 shows `paused` in the database and the jobs column, its journal carries the `PAUSED` line, and no runner process remains; `dispatch resume` restarts it, unit 2 runs again on the restored tree, unit 3 follows, the chain completes with exactly three job rows and one completed event; `zsh -n` passes on both scripts; server tests pass. Commit.

## Job 2 — Codex context window truth (appended 2026-08-27). Verify: yes

Goal: the worker pane's context window figure for a Codex session is the session's current context, updated live, with an honest breakdown. Today it shows the rollout's cumulative `total_token_usage` (3.6M after 42 turns, mostly cache reads) against the 258k window and reads 100%. Files: `server/modules/providers/services/provider-token-usage.service.ts` (the rollout `token_count` reader near line 125-155), the sessions watcher hook that already pushes `chatgpt_usage` frames, the context window control in the composer and its breakdown popover, `design/composer.md`. Dependencies: none.

- [ ] Current context, not cumulative: for a Codex session the used figure is `last_token_usage.total_tokens` of the newest `token_count` event (the last turn's full input plus output), the window is `model_context_window`; the percentage follows. Cumulative totals stay available for the per-job token count (ui15 job 11) but never feed the context window.
- [ ] Breakdown for Codex: the popover shows what the rollout knows for the last turn, labeled plainly: input from cache, fresh input, output, reasoning, and the window; no Claude-only categories, no invented split; when no `token_count` event exists yet it says "no reading yet".
- [ ] Live: the figure and breakdown update as new `token_count` events land in the rollout, pushed over the existing WebSocket from the same sessions-watcher hook that feeds the ChatGPT usage meters; no refresh needed; nothing polls while nothing is watching.

Done check: on dev, open the worker pane on a live Codex session (a real `codex exec` in `~/Projects/codex-smoke` is fine): the control shows the last turn's total over the window and the percentage matches a jq read of the newest `token_count` event; the popover lists the five Codex fields with matching numbers; a further turn updates both without reload; a Claude session's figure and breakdown are unchanged. Commit.
