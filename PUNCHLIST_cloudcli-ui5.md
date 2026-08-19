# PUNCHLIST cloudcli-ui5

Goal: make the planner UI honest and quiet: silent boot, real context ring, a worker pane that reflects what is actually running, and cosmetic cleanup. All work verifies against the dev instance per the repo's documented dev/promote flow before promote.

Whole-file rules: read DESIGN.md in the repo root before any UI work; it is the source of truth for look and feel. Find the closest existing element and reuse its component or exact classes; a new variant extends the existing pattern, never a parallel style. Ensure .gitignore excludes .env before any git add. Check each item off in this file as it is verified. Claims of progress are checked against actual tool results. Confirm visible changes also hold at a phone viewport. Keep the final message brief. You have ample context; do not stop, summarize, or suggest a new session on account of context limits. After the final phase verifies, run the repo's documented promote flow (dev verify, drain, promote to live).

## Phase 1: silent boot and honest titles
- [x] New Session locks the composer until the planner's ready message posts; a loading indicator (existing design language) shows during boot
- [x] The auto-sent boot prompt and its tool-call turn are hidden from the transcript; the planner's ready message is the first visible content
- [x] If the boot turn errors (API down, command missing), show a plain failure indicator with a retry, never a silent dead session
- [x] Chat titles derive from the first real user-typed message; never from the auto-sent boot text; existing sessions titled from boot text is acceptable to leave
Done when: in the dev instance browser, creating a session shows loading then a ready message with no boot prompt visible, the composer is disabled until ready, a simulated boot failure shows the indicator, and a new session titled from a typed test message appears in the sidebar. Commit.

## Phase 2: context ring truth
- [ ] Diagnose why the ring jumps on boot and why it counts up then resets per message; read the ring math and the server usage source first
- [ ] Fix so the ring shows cumulative session context against the session model's real window, monotonic within a session, matching the server's own usage numbers
Done when: on dev, after boot plus two messages, the ring percentage equals the server-reported cumulative context for that session and does not reset between messages. Commit.

## Phase 3: worker pane honesty
- [ ] Run switcher in the pane header: list active and recent dispatched runs for the project, newest selected by default, switching swaps the transcript
- [ ] Header shows run slug and plain state (running, finished, stopped) instead of Untitled Claude Session
- [ ] The pane's model indicator reflects the selected run's actual model; remove any hardcoded default (Haiku or otherwise); model is whatever the run was dispatched with
Done when: on dev with two dispatched runs present (create two trivial ones if none exist, in a scratch-safe way per repo docs), the switcher lists both, states render correctly, and each shows its own model. Commit.

## Phase 4: cosmetic sweep
- [ ] Remove project stars from the sidebar; shift the project list left to reclaim the space
- [ ] Sidebar session activity indicators show only while a session is actively mid-turn; no standing dots on idle sessions
- [ ] Replace the floating bottom-left thinking box with an inline thinking indicator in the message flow using a subtle shimmer, consistent with DESIGN.md motion rules
Done when: on dev, an idle session shows no dot and a mid-turn session shows one; no star icons render; sending a message shows the inline shimmer where the reply will appear. Then run the promote flow. Commit and push.
