-- Project list cleanup (2026-08-19).
-- Run against the live DB: sqlite3 ~/.cloudcli/auth.db < scripts/2026-08-19-project-list-cleanup.sql
-- Sets display names on the twelve kept projects (resolved by repo folder under
-- /Users/spoton-worker/Projects) and archives every other project row.
-- The scratch project row is left untouched: it is hidden by code (isScratchProjectPath).

UPDATE projects SET custom_project_name = 'SPOTON STATS'   WHERE project_path = '/Users/spoton-worker/Projects/spoton-stats';
UPDATE projects SET custom_project_name = 'SPOTON GATEWAY' WHERE project_path = '/Users/spoton-worker/Projects/acculynx-gateway';
UPDATE projects SET custom_project_name = 'SPOTON CAM'     WHERE project_path = '/Users/spoton-worker/Projects/snapbridge-photos';
UPDATE projects SET custom_project_name = 'SPOTON SIGN'    WHERE project_path = '/Users/spoton-worker/Projects/SignTool';
UPDATE projects SET custom_project_name = 'SPOTON CORE'    WHERE project_path = '/Users/spoton-worker/Projects/spoton-core';
UPDATE projects SET custom_project_name = 'SPOTON PAYROLL' WHERE project_path = '/Users/spoton-worker/Projects/spoton-payroll';
UPDATE projects SET custom_project_name = 'GHL RECRUITING' WHERE project_path = '/Users/spoton-worker/Projects/ghl';
UPDATE projects SET custom_project_name = 'PROXY FEED'     WHERE project_path = '/Users/spoton-worker/Projects/proxyfeed';
UPDATE projects SET custom_project_name = 'BOOKS'          WHERE project_path = '/Users/spoton-worker/Projects/spoton-book';
UPDATE projects SET custom_project_name = 'NOGGIN'         WHERE project_path = '/Users/spoton-worker/Projects/noggin';
UPDATE projects SET custom_project_name = 'CLOUD CLI'      WHERE project_path = '/Users/spoton-worker/Projects/cloudcli';
UPDATE projects SET custom_project_name = 'TESLA HUNT'     WHERE project_path = '/Users/spoton-worker/Projects/tesla-hunt';

-- Keep the twelve active, archive everything else (except scratch).
UPDATE projects SET isArchived = 0 WHERE project_path IN (
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
    '/Users/spoton-worker/Projects/tesla-hunt'
);

UPDATE projects SET isArchived = 1 WHERE project_path NOT IN (
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
