# PUNCHLIST cloudcli-ui3

Goal: third polish round on the CloudCLI fork. Sharper corners, quieter focus states, claude.ai-parity model switcher, corrected context-window math surfaced everywhere, a handoff button, a slimmer composer, and a first catch-up pass against upstream plus groundwork for moving the server onto an always-on host. The app already runs the Claude.ai-style design system from rounds 1-2; DESIGN.md in the repo root is the source of truth.

Final acceptance: every checkbox below checked off in this file, each verified in the running app at http://127.0.0.1:4747 at desktop width, committed per phase, pushed at the end.

Whole-file rules:
- Read DESIGN.md in the repo root before any UI work; it is the source of truth for look and feel. Find the closest existing element and reuse its component or its exact classes and styles. A new variant extends the existing pattern; never introduce a parallel style. Match the app's existing colors, spacing, fonts, and corner and shadow treatment. Update DESIGN.md when a token or pattern changes.
- All UI changes are desktop-only gated; mobile keeps its existing controls and layouts.
- Ensure .gitignore excludes .env before any git add. Check items off in this file as they are verified, commit this file with each phase's work. Phase 1 commits this file initially.
- Before reporting progress or completion, check each claim against an actual tool result from this session; report only what you can point to evidence for, and if something is unverified, say so plainly.
- On unrecoverable failure stop and state what blocks, leaving completed phases committed.
- Match the length of what you write to what the task needs. You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

## Phase 1 - Design polish and composer (goal: quieter, sharper chrome)

Files: src/index.css (tokens), DESIGN.md, composer components, sidebar/header components carrying the update indicator.

- [x] 1. Corner radius token reduced ~30%: the 12px radius token becomes 8px, applied everywhere the token is consumed. Any hardcoded 12px radii on desktop surfaces migrate to the token. DESIGN.md updated. Done check: computed border-radius on the composer, message bubbles, model pill, and popovers reads 8px.
- [x] 2. Composer focus state: clicking into the message box shows a subtle lighter-gray border/ring instead of the orange accent. The accent token stays untouched elsewhere. Done check: focused composer border computes to the new gray, not rgb(201, 98, 64).
- [x] 3. Slash-commands icon redrawn to match the plus icon's visual language: a single diagonal stroke of the same length and stroke-width as one arm of the plus, same 32px hit area. Done check: both SVGs share stroke-width and effective stroke length in the DOM.
- [x] 4. Handoff button added immediately right of the slash-commands button, bottom-left cluster of the composer: document-style icon, same size and treatment as its neighbors, tooltip "Handoff". Clicking it executes the /handoff user command through the same path the New Session planner boot uses (/api/commands/execute reading ~/.claude/commands/handoff.md) and sends it into the current session. Desktop only. Done check: button renders in the cluster, click produces a sent handoff message in a live session.
- [x] 5. Update-available indicator removed entirely on desktop and mobile; the fork tracks upstream manually. Any version-check network call behind it is disabled, not just hidden. Done check: no update badge/toast in the DOM and no version-check request fired on load.
- [x] 6. Composer slimmed to claude.ai proportions: default height fits exactly one line of input ("Write a message..." single line plus the control row), grows upward as content wraps, shrinks back when cleared. If autogrow already exists, correct the min-height so the at-rest state is genuinely one line. Done check: at-rest composer height measurably smaller than current build and equal to one text line plus controls; typing three lines grows the box upward without inner scroll until a sane max.

Dependencies: none. Parallelism: items are small and adjacent; run in-thread, no delegation. Verify with agent-browser DOM checks, then a fresh-context reviewer subagent audits the diff against this phase before commit. Commit, push.

## Phase 2 - Model switcher parity (goal: exact claude.ai More models behavior)

Files: model switcher component and its model-list config.

- [x] 7. More models submenu splits into current and legacy groups with a divider, matching claude.ai: current group Fable 5, Sonnet 5, Haiku 4.5; legacy group below the divider Opus 4.8, Opus 4.7, Opus 4.6, Opus 3, Sonnet 4.6, in that order.
- [x] 8. The currently selected model is hidden from the More models list (it already renders as the checked card above), matching claude.ai. Selecting any model updates the hidden entry accordingly.
- [x] 9. The model list, grouping, and order live in one plain config array (id, friendly name, tagline, group) so future models are a one-line addition. A short comment names the file's purpose.

Dependencies: phase 1 committed (shared composer area). Done check: with Fable 5 selected, More models shows exactly Sonnet 5 and Haiku 4.5 above the divider and the five legacy models below it; selecting Sonnet 5 re-lists Fable 5 in the current group; websocket payload still carries correct real model ids. Fresh-context reviewer audits before commit. Commit, push.

## Phase 3 - Context-window truth and popover anchoring (goal: the ring and popover never lie, and sit where they should)

Files: usage popover component, token-budget plumbing (client store + server budget message), whatever the diagnosis implicates.

- [x] 10. Bug: the live app still shows "98.6k / 160k (62%)" after the phase-4 fix (commit 219d117) and a hard refresh. Diagnosis is gated on reproduction: first build one reliable red check that shows the wrong denominator in the running app (an agent-browser assertion on the popover or ring attribute for an affected session). No repro, no theorizing. Candidate paths to rule in or out only after the repro exists: a per-session token budget persisted from before the fix that only refreshes on the next completed turn, a code path still preferring the .env CONTEXT_WINDOW value, or the server process running a stale build. Find root cause, state it in one plain line grounded in tool output, fix minimally so idle and historical sessions surface the honest denominator on load without requiring a new message. Done check: the repro goes green; reopening an old session shows the SDK-derived window in both ring and popover before any message is sent.
- [x] 11. Usage popover anchoring: the popover's left edge aligns with the left edge of the ring button and it opens upward, Claude-desktop style; it never overlaps the sidebar at any window width down to the desktop minimum. Done check: bounding-box comparison of popover left edge vs button left edge at two window widths, no intersection with the sidebar rect.

Dependencies: phase 1 committed. Item 10 before item 11 in the same session. Fresh-context reviewer audits before commit. Commit, push.

## Phase 4 - Upstream catch-up and host groundwork (goal: fork current with upstream, server ready to live on a remote always-on machine)

Files: git remotes, server config, whatever the review implicates.

- [x] 12. Upstream review: ensure an upstream remote exists (add it from the fork's parent if missing), fetch, and review every upstream commit since the merge-base with our main. Classify each as backend (bug fixes, security, session/SDK handling) or frontend (UI/UX). Apply backend changes that are meaningful and compatible with our overhaul; skip anything that would fight our design system or removed surfaces. For frontend commits, adopt only ones that are clear wins compatible with DESIGN.md. The final message lists every upstream commit reviewed with taken or skipped and a one-line reason each; report everything found, ordered by significance.
- [x] 13. Host groundwork: the server's bind address becomes configurable via env (default stays 127.0.0.1; setting HOST=0.0.0.0 serves on all interfaces for Tailscale access) with the port equally configurable, documented in one line in CLAUDE.md. Done check: server started with HOST=0.0.0.0 answers on the machine's LAN/Tailscale address; default start still binds localhost only.
- [x] 14. Portability audit, report only: scan the fork's added/modified code for Windows-only assumptions (hardcoded backslash paths, drive letters, PowerShell-only child processes, Windows binary names like the bundled ripgrep) that would break on macOS. The deliverable is a findings list in the final message ordered by severity; report and stop, do not apply fixes beyond item 13.

Dependencies: phases 1-3 committed. Done check: items 12-13 verified as stated, item 14 delivered as a report. Fresh-context reviewer audits the applied upstream changes before commit. Commit, push.
