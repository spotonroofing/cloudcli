# PUNCHLIST command-center-ui

Goal: strip Command Center's desktop chrome down to a chat-first, Claude.ai-feeling interface for the Orca-docked planner view, and wire new sessions to boot the planner automatically. Desktop only; the mobile/responsive views keep every existing tab and control untouched. Upstream is frozen; these are our own iterations.

Final acceptance: at http://127.0.0.1:4747 in a project-scoped view, the desktop UI shows only what these items leave standing, every remaining control works, and a new session boots the planner for that project without typing.

## Whole-file rules

- Ensure .gitignore excludes .env before any git add. Commit at each phase boundary, push at the end of each phase. Phase 1 commits this punch list file with its own work.
- Check items off in this file as each is verified, before the phase commit. Trust repo state over prompt text when they disagree.
- Read DESIGN.md in the repo root before any UI work; phase 1 creates it if missing (tokens plus reusable-element inventory with file paths). Find the closest existing element and reuse its component or exact classes; a new variant extends the existing pattern, never a parallel style. Match the app's colors, spacing, fonts, and corner and shadow treatment as redefined by phase 1.
- Desktop only: gate removals so mobile/responsive layouts keep the current tabs and controls. If desktop and mobile share a component, branch by viewport or a desktop flag, never fork the file wholesale.
- After each phase's changes, rebuild the client bundle (the server serves it straight from disk; a stale bundle hides everything) and verify against the running server at http://127.0.0.1:4747.
- UI verification runs through the agent-browser skill on snapshot text and DOM state, never pixels. Screenshots are evidence for Willem only. Purely aesthetic judgments (font feel, bubble look) get a DOM-level check that the intended classes/tokens apply; Willem does the final eyeball pass.
- The ui-library skill is available for any component expensive to self-build (the token progress ring is the likely candidate); retheme pulls to DESIGN.md.
- Progress honesty: before reporting, check each claim against an actual tool result; report only what you can point to evidence for. Match the length of what you write to what the task needs. On unrecoverable failure stop and state what blocks, leaving completed phases committed.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

## Phase 1: Design system (font, radius, bubbles, copy button)

Goal and scope: establish the visual foundation the later phases build on. Styling and small component edits; no chrome removal yet.
Dependencies: none. Parallelism: items are small and interlocking; run solo, no fan-out.

- [x] 9. App-wide font swapped to a simple Anthropic-Sans-adjacent sans (self-hosted; pick a close open font, no CDN dependency). Message content may use a slightly different cut than UI chrome if it reads better; both defined as CSS variables in DESIGN.md.
- [x] 12. One consistent Claude.ai-like corner radius token applied app-wide; the mismatched smaller bottom-right bubble corner is gone. Done: no element in the chat view carries an asymmetric radius.
- [x] 11. User message bubbles restyled Claude.ai-dark: lighter gray bubble on the darker background, white text; the blue bubble and the U avatar circle are gone. Done: DOM shows no avatar element on user messages; bubble styles match the new tokens.
- [x] 10. Message copy control is a single copy button: no MD/TXT label, no format dropdown; it always copies the message as plain text. Done: one button per message, clipboard write is plain text.

Done check: agent-browser snapshot of a scoped session page shows the new bubble structure (no avatar, no MD/TXT labels), computed styles carry the new font and radius variables; client bundle rebuilt and served. Fresh-context verifier reviews the diff against these four items. Commit, push.

## Phase 2: Chrome strip (sidebar and top bars)

Goal and scope: remove desktop chrome. Removal-only phase; shell and sidebar components.
Dependencies: phase 1 tokens (any surviving chrome inherits them). Parallelism: solo.

- [x] 1. Command Center branding/wordmark removed everywhere on desktop (sidebar header text/logo and anywhere else upstream branding surfaces).
- [x] 2. Projects tab removed from the desktop sidebar; Conversations and Archive remain.
- [x] 3. Running-sessions tab removed on desktop.
- [x] 4. Ctrl+K shortcut hint removed from the search box.
- [x] 5. Report Issue and Join Community removed in both sidebar-open and sidebar-collapsed states.
- [x] 6. Chat/Shell/Files/Source Control view-mode bar removed on desktop; chat is the only view. Routes or state for the removed views must not be reachable from desktop UI.
- [x] 7. Chat-title top bar removed entirely on desktop.

Done check: agent-browser snapshot contains none of the removed labels (Projects, Shell, Files, Source Control, Report Issue, Join Community, Ctrl+K, the wordmark, the session title bar) on desktop viewport, and all of them still present at a phone viewport; bundle rebuilt and served. Fresh-context verifier on the diff. Commit, push.

## Phase 3: Scoped-only conversations

Goal and scope: the project-scoped view becomes the only desktop view; router and conversation-list data.
Dependencies: phase 2 (sidebar shape settled). Parallelism: solo.

- [x] 8. Desktop conversations list shows only the current project's sessions; the global all-projects view is removed on desktop (no switcher, no escape). The scoped /project/:projectId route contract is unchanged so Orca tab URLs keep working; hitting the bare root on desktop lands somewhere sane (most recent project or a pick-a-project state), not the old global list.

Done check: agent-browser on a scoped URL shows only that project's sessions; the bare root on desktop does not render the global all-projects list; mobile behavior unchanged; bundle rebuilt and served. Commit, push.

## Phase 4: Composer rebuild (Claude.ai style)

Goal and scope: the bottom bar becomes one unified Claude.ai-style box. Composer components and styles; behavior stays wired.
Dependencies: phase 1 tokens. Parallelism: solo.

- [x] 15. One unified rounded box: text input on top; one control row inside the same box below it. Left: plus button; right: model selector, then send button. Consistent sizing, nothing split into separate boxes, nothing overlapping at any pane width.
- [x] 14. Placeholder text is "Write a message..."
- [x] 13. All composer hint text removed (Enter to send / Shift+Enter / Tab modes / slash-command hints).
- [x] 16. Slash-command button kept; its count badge (the 40) removed.
- [x] 18. Permission selector removed from the composer; sessions always start with skip-permissions as the hardwired default wherever session spawn options are set.
- [x] 17. Token usage indicator replaced with a small circular progress ring (Claude-desktop style) showing percent of context used; clicking it opens the existing usage menu unchanged.

Done check: agent-browser snapshot shows the unified composer with exactly the specified controls and none of the removed text/badges; DOM confirms no overlap at ~700px and full width (bounding boxes disjoint); a test message still sends; sessions spawn with skip-permissions; bundle rebuilt and served. Fresh-context verifier on the diff. Commit, push.

## Phase 5: New Session boots the planner, /planner command

Goal and scope: session-creation flow and command wiring.
Dependencies: phase 3 (scoping supplies the project). Parallelism: solo.

- [x] 19. Sidebar-header create button relabeled New Session (refresh button stays); it creates a session in the current scoped project.
- [x] 20. A newly created session automatically sends the planner boot for that project. Read ~/.claude/commands/planner.md first: if Command Center's session layer can invoke Claude Code slash commands, boot by sending /planner with the project argument that command expects; if it cannot, send the equivalent full boot text the command performs, templated with the scoped project's name and paths (the per-project planner dirs under spoton-worker/planner/<project>/). One source of truth: derive the text from the command file, do not hand-copy a stale prompt.
- [x] 21. Typing /planner in the composer triggers the same boot in the current session, recognized natively by Command Center's command handling.

Done check: agent-browser creates a new session in a scoped project and the first message in the transcript is the planner boot (slash or templated text) for that project; typing /planner in an existing session sends the same; bundle rebuilt and served. Fresh-context verifier on the diff. Commit, push. Final line of the run states which boot path shipped (slash passthrough or templated text).
