# PUNCHLIST cloudcli-ui6

Goal: projects and chats become strictly what Willem creates, models report honest names and windows, and the chrome loses everything unused. The ccsync relay retirement already ran; ~/forge-logs/cloudcli-ui6/purged-sessions.txt lists the removed foreign transcripts.

Whole-file rules: read DESIGN.md in the repo root before any UI work; it is the source of truth. Reuse the closest existing pattern; never introduce a parallel style. Ensure .gitignore excludes .env before any git add. Check each item off in this file as verified. Claims are checked against actual tool results. Confirm visible changes hold at a phone viewport. You have ample context; do not stop, summarize, or suggest a new session on account of context limits. After the final phase verifies, run the repo's documented promote flow (dev verify, drain, promote to live).

## Phase 1: strictly manual projects and data cleanup
- [x] The session synchronizer never creates project rows: remove the createProjectPath calls in the discovery path (sessions.db.ts createSession and siblings); discovered sessions with no existing project land project-less via the shipped scratch/standalone machinery; manual project creation and manual attach-to-project stay exactly as they are
- [x] Data fix: delete the Windows-path project rows (C:\Users\... and any other path-derived strays outside the curated named set) and the session rows belonging to them or to transcripts named in purged-sessions.txt (applied to live and dev DBs; scripts/2026-08-20-strict-manual-projects-cleanup.sql, re-run at promote since the old live build can re-create local strays until then)
Done when: the dev sidebar lists only the curated named projects, a synthetic transcript dropped into ~/.claude/projects under a novel cwd appears as a standalone session and creates no project row after a rescan, and manual attach still works. Commit.

## Phase 2: chats feed and worker hygiene
- [x] Read the origin tagging first and determine which origin values mean Willem started the session in the UI (project New Session chats and scratch chats) versus machine-started (dispatch, worker pane direct, watchdog-spawned); filter the recent-conversations query so only Willem-started sessions appear (origin NULL = scratch/ordinary chats, 'planner' = project New Session chats; 'direct' and 'dispatch' are machine-started and now excluded from getRecentSessionsPage)
- [x] The handoff button renders only in planner project chats; hidden in the worker pane and standalone/scratch chats (gated on the selected session's origin, falling back to the surface origin for a fresh new-session view)
Done when: on dev, the Chats feed shows a freshly created project chat and a scratch chat but not a dispatched run or a worker-pane session; the worker pane composer has no handoff button while a project chat still does. Commit.

## Phase 3: model truth
- [x] Add a per-model context window catalog alongside the model OPTIONS: published window per model id (Fable 5 is 1M, observed live; Opus 5 is 200k by default and 1M only with the account's usage-credits toggle, so catalog it at 200k), used as the default everywhere the 160k constant is used today; the runtime-learned cache overrides the catalog once a real window is observed; 160k remains only for model ids in neither catalog nor cache (CLAUDE_CONTEXT_WINDOWS in claude-models.provider.ts; catalog also beats the CONTEXT_WINDOW env guess)
- [x] Friendly model names everywhere: extend the label lookup with a prettifier fallback (claude-opus-5 renders as Opus 5) so a raw model id never reaches the screen, in the switcher, worker pane rows, and anywhere else ids render (src/utils/modelLabels.ts; wired into switcher, worker runs menu, /model + /cost modals, Agent tool detail, provider empty state)
Done when: on dev, selecting Opus 5 shows Opus 5 in the switcher and its ring denominates against 200k before any turn completes; an id absent from OPTIONS renders prettified; the ring behavior for Fable 5 is unchanged. Commit.

## Phase 4: settings purge
- [x] Remove the Agents, Tasks, Browser, Plugins, Git, Voice, and API Tokens tabs from settings, including their routes and registration entries; leave the api_keys table, its auth middleware, and every guarded endpoint fully intact (tab components/hooks deleted, registrations trimmed to appearance/notifications/about, /api/settings/api-keys CRUD removed; credentials routes kept for the project wizard, shared modules untouched; browser panel gear that opened the removed tab also gone)
Done when: on dev, settings shows none of the removed tabs, no dead links or console errors, and a dispatch CLI call authenticated with the existing key still succeeds against the watchdog status endpoint. Commit.

## Phase 5: chrome cleanup
- [x] Remove the Choose Your AI Assistant empty state entirely; a new or empty chat opens straight to the composer (ProviderSelectionEmptyState.tsx deleted; ChatMessagesPane renders nothing for an empty chat; dead prop plumbing trimmed from ChatInterface)
- [x] Remove the per-message Claude name tag and icon above assistant messages (MessageComponent header now renders only for error/tool rows; error and tool marks unchanged)
- [x] Remove project and delete project actions get a confirmation dialog using the app's existing dialog pattern (the project dialog in SidebarModals gained a second stage: Archive project and Delete all data each show a named confirm view with Cancel returning to the chooser; nothing acts until the confirm button)
Done when: on dev, an empty chat shows no provider chooser, assistant messages render without the name tag, and clicking remove or delete on a project shows a confirmation that cancels cleanly and only acts on confirm. Then run the promote flow. Commit and push.
