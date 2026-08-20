-- Strictly-manual projects cleanup (2026-08-20, PUNCHLIST_cloudcli-ui6 phase 1).
-- Ran against live (~/.cloudcli/auth.db) and dev (~/.cloudcli-dev/auth.db).
-- Deletes every path-derived project row outside the curated named set (the
-- twelve projects named in scripts/2026-08-19-project-list-cleanup.sql plus the
-- hidden scratch row) and the session rows belonging to them. Session rows for
-- the purged foreign relay transcripts (~/forge-logs/cloudcli-ui6/
-- purged-sessions.txt) were deleted in the same pass by session id:
--   DELETE FROM sessions WHERE session_id IN (...purged ids...)
--      OR provider_session_id IN (...purged ids...);
-- From this date the synchronizer no longer creates project rows (see
-- sessions.db.ts), so strays cannot return once the new build is promoted.
-- Until that promote, a live-instance rescan on the old build can re-create
-- rows for local non-curated cwds; re-run this script at promote time.

BEGIN;

DELETE FROM sessions WHERE COALESCE(assigned_project_path, project_path) IN (
    SELECT project_path FROM projects WHERE project_path NOT IN (
        '/Users/spoton-worker/Projects/spoton-stats',
        '/Users/spoton-worker/Projects/acculynx-gateway',
        '/Users/spoton-worker/Projects/snapbridge-photos',
        '/Users/spoton-worker/Projects/SignTool',
        '/Users/spoton-worker/Projects/spoton-core',
        '/Users/spoton-worker/Projects/spoton-payroll',
        '/Users/spoton-worker/Projects/ghl',
        '/Users/spoton-worker/Projects/proxyfeed',
        '/Users/spoton-worker/Projects/spoton-book',
        '/Users/spoton-worker/Projects/noggin',
        '/Users/spoton-worker/Projects/cloudcli',
        '/Users/spoton-worker/Projects/tesla-hunt',
        '/Users/spoton-worker/Projects/scratch'
    )
);

DELETE FROM projects WHERE project_path NOT IN (
    '/Users/spoton-worker/Projects/spoton-stats',
    '/Users/spoton-worker/Projects/acculynx-gateway',
    '/Users/spoton-worker/Projects/snapbridge-photos',
    '/Users/spoton-worker/Projects/SignTool',
    '/Users/spoton-worker/Projects/spoton-core',
    '/Users/spoton-worker/Projects/spoton-payroll',
    '/Users/spoton-worker/Projects/ghl',
    '/Users/spoton-worker/Projects/proxyfeed',
    '/Users/spoton-worker/Projects/spoton-book',
    '/Users/spoton-worker/Projects/noggin',
    '/Users/spoton-worker/Projects/cloudcli',
    '/Users/spoton-worker/Projects/tesla-hunt',
    '/Users/spoton-worker/Projects/scratch'
);

COMMIT;
