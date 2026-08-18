# PUNCHLIST cloudcli-ui2

Goal: second polish round on the chat-first desktop UI: Claude.ai accent and send button, an exact Claude.ai-style model switcher with sane naming, cleaner tool blocks and sidebar chrome, a Claude-desktop-style usage menu with honest math, and a tidied commands button. Desktop only except where an item says otherwise; upstream stays frozen.

Final acceptance: at http://127.0.0.1:4747 the desktop UI reflects every item below, every touched control still works, and DESIGN.md carries the new accent token.

## Whole-file rules

- Ensure .gitignore excludes .env before any git add. Commit at each phase boundary, push at the end of each phase. Phase 1 commits this punch list file with its own work.
- Check items off in this file as each is verified, before the phase commit. Trust repo state over prompt text when they disagree.
- Read DESIGN.md before any UI work and update it as tokens change (phase 1 replaces the accent). Find the closest existing element and reuse its component or exact classes; new variants extend existing patterns, never a parallel style.
- Desktop-first: sidebar and chrome items are desktop-only (mobile keeps current layout); theme tokens (accent, send button) apply everywhere since they are tokens, matching how the composer already ships at all widths.
- After each phase's changes, rebuild the client bundle (the server serves it from disk) and verify against the running server at http://127.0.0.1:4747.
- UI verification runs through the agent-browser skill on snapshot text and DOM state, never pixels; screenshots are evidence for Willem only. Willem does the final eyeball pass.
- Progress honesty: check every claim against a tool result before reporting; report only what you can point to evidence for. On unrecoverable failure stop and state what blocks, leaving completed phases committed.
- You have ample context; do not stop, summarize, or suggest a new session on account of context limits.

## Phase 1: Accent and send button

Goal and scope: swap the blue accent for Claude's terracotta accent as a token change, and restyle the send button. Dependencies: none. Parallelism: solo.

- [x] 1. Accent color: every use of the current blue accent (active states, selection ticks, links, progress ring fill, focus states, the send button) moves to a Claude-style terracotta/burnt-orange accent defined as a DESIGN.md token (Claude.ai's send button orange, roughly #C96442 family; pick the exact value once, use it everywhere via the token). No blue accent remains anywhere in the desktop UI.
- [x] 2. Send button: rounded-square button in the accent color with a thin line-style upward arrow (a minimal stroke arrow, not a filled or right-pointing one), sized consistently with the other composer controls.

Done check: DOM shows no elements carrying the old blue accent classes/variables; the send button renders the accent token and an up-arrow SVG with stroke styling; bundle rebuilt and served. Commit, push.

## Phase 2: Model switcher, Claude.ai clone

Goal and scope: replace the model selector and reasoning menu wholesale with a Claude.ai-style switcher. Composer selector components plus whatever maps display choices to session model/effort settings. Dependencies: phase 1 accent. Parallelism: solo.

- [x] 3. Collapsed state: a single pill reading the friendly model name, then the effort level in dimmer text, then a chevron, e.g. "Fable 5  Medium ⌄". Never a raw model id like claude-fable-5.
- [x] 4. Expanded state, exactly this structure: a card showing the current model with name, one-line tagline, and a check ("Fable 5 / For your toughest challenges"); below it a row "Effort" showing the current level with a right chevron opening the effort submenu; below that a row "More models" with a right chevron opening the model list.
- [x] 5. Effort submenu: header text "Higher effort means more thorough responses, but takes longer and uses your limits faster." then options Low, Medium, High (with a small Default badge), Extra, Max. Internally Extra maps to the existing xhigh setting; the wire format to the server/SDK does not change, only labels. No option named Xhigh, Default, or anything else appears.
- [x] 6. More models list, friendly names only, this set and casing: Fable 5, Sonnet 5, Haiku 4.5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6, Opus 3. Each maps to its correct model id under the hood. The current entries Default (recommended), Best available, Opus Plan, and the 1M-context variants are removed as choices. Selecting a model updates the collapsed pill and the session's model setting.
- [x] 7. Taglines for non-Fable models: short one-liners in the same voice (e.g. Sonnet 5 "Fast and capable", Haiku 4.5 "Fastest for everyday tasks", Opus 4.8 "Deep reasoning"); keep them brief, they render in the card when selected.

Done check: agent-browser opens the switcher; snapshot shows the card, Effort row, More models row, the exact effort options with High carrying the Default badge, and the exact model list above; no raw model ids anywhere in the switcher; selecting Sonnet 5 then Extra updates the pill to "Sonnet 5  Extra" and a sent test message carries the mapped model id and xhigh effort in the network payload. Fresh-context verifier on the diff. Commit, push.

## Phase 3: Tool blocks, sidebar top bar, flyout, settings pin

Goal and scope: chat tool-row styling plus sidebar chrome. Dependencies: phase 1 accent. Parallelism: solo.

- [x] 8. Tool indicator rows (Read, Bash, etc.): remove the layered offset-gray wraparound treatment; every tool row uses one consistent treatment matching the Glob row style: a solid left rule, or a single clean full border, identical across all tool row types. No shifted or stacked-layer look anywhere in the transcript.
- [x] 9. Sidebar top bar: the Conversations|Archive selector becomes a 50/50 equal-width segmented control living inside the top button bar alongside the reload, new-session, and collapse buttons; below the top bar comes search, then the conversations list, and nothing else. The old separate pill row is gone.
- [x] 10. The teal quick-settings flyout arrow on the right edge of the chat area is removed; any setting that exists only in that flyout moves into the Settings page (skip duplicates). List in the final message which settings moved.
- [x] 11. Collapsed sidebar rail: Settings stays pinned at the bottom-left; nothing about collapsing moves it up.

Done check: agent-browser snapshot shows no flyout tab on the right edge, the segmented control in the top bar with equal widths (bounding boxes within a few px), search directly below, Settings at the rail bottom when collapsed; transcript tool rows all carry the single consistent treatment. Fresh-context verifier on the diff. Commit, push.

## Phase 4: Usage menu, ring math, commands button

Goal and scope: the usage popover, the ring's denominator, and the commands button. Dependencies: phase 1 accent. Parallelism: solo.

- [x] 12. Usage popover rebuilt Claude-desktop style: a "Context window" header row reading "<used>k / <limit> (<percent>)" with a chevron; expanding it shows a per-category breakdown with amounts and percentages (system tools, MCP tools, system prompt, skills, messages, free space, plus deferred categories if the data exists), each with a small colored bar or dot. No plan-usage or billing section. Use whatever context-accounting data the SDK/server already exposes; if a category is unavailable, omit it rather than faking it.
- [x] 13. Ring and popover math made honest: establish what the current percent divides by (raw model window, 1M, or usable-before-autocompact) and what the session's actual model window is; then make ring and popover agree on used tokens over the session model's real usable window, labeled so the number cannot mislead (if the denominator is the pre-autocompact usable window, the popover says so). State the root cause of the 62%-at-98k reading in the final message.
- [x] 14. Commands button: icon becomes a slash glyph (replacing the chat-box icon), it sits immediately left of the usage ring in the control row, and the command list it opens shows user commands (from ~/.claude/commands) in a top section with all built-ins below.

Done check: agent-browser opens the usage popover, snapshot shows the context-window row and expanded breakdown categories with no plan section; the ring percent equals the popover math for the live session; commands menu shows the user-commands section first and the button renders the slash icon left of the ring. Fresh-context verifier on the diff. Commit, push. Final line states the ring-math root cause.
