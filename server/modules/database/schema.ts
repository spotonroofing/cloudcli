const USER_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);
`;

export const API_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const VAPID_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    label TEXT,
    metadata_json TEXT,
    enabled BOOLEAN DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel, endpoint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    planner_memory_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
);
`;

export const SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    -- The session id used by the provider CLI/SDK on disk (JSONL file name,
    -- store.db folder, sqlite row id, ...). \`session_id\` is the stable
    -- app-facing id that the frontend uses for the whole session lifetime;
    -- \`provider_session_id\` is filled in once the provider announces its own
    -- id mid-run, or equals \`session_id\` for sessions discovered on disk.
    provider_session_id TEXT,
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    -- Model, reasoning effort, and Codex fast-mode choice this session runs
    -- with. Written when the user changes a selection and on every send, so
    -- reopening a session restores its exact runtime configuration instead of
    -- provider defaults.
    model TEXT,
    effort TEXT,
    fast_mode BOOLEAN,
    -- App-owned project assignment (attach-to-project). The filesystem
    -- synchronizer never touches it; reads prefer it over the cwd-derived
    -- project_path.
    assigned_project_path TEXT,
    -- Worker-lane metadata: how the session was started ('direct' from the
    -- worker pane, 'dispatch' from the chain runner, NULL otherwise), the
    -- project HEAD when the run began, and the dispatch chain slug the run
    -- belongs to (NULL for direct and free-standing runs).
    origin TEXT,
    base_commit TEXT,
    chain_slug TEXT,
    -- 1-based unit index of the run inside its dispatch chain (ui9 B4), so
    -- the switcher and phase navigator can map a session to its manifest
    -- entry; NULL for direct and free-standing runs.
    chain_phase INTEGER,
    -- Planner handoff/rotation lineage. A successor stores the app-facing id
    -- of the planner session it replaced, so watchdog wakes can follow the
    -- dispatching chat instead of whichever chat was touched most recently.
    predecessor_session_id TEXT,
    -- One active conversation per project is the fallback destination for
    -- wakes without chain lineage (maintenance, self-test, manual routing).
    watchdog_wake_target BOOLEAN NOT NULL DEFAULT 0,
    -- 1 when the first message was an auto-sent boot prompt (/planner or
    -- /worker New Session); the client hides exactly those prologues.
    booted INTEGER DEFAULT 0,
    -- Boot lifecycle, persisted so a restart cannot reopen an aborted boot as
    -- a plain chat: NULL = not a boot session, 'pending' = boot prompt sent,
    -- 'ready' = boot turn completed, 'failed' = boot errored or was aborted
    -- (pending rows are swept to 'failed' at server start).
    boot_state TEXT,
    -- One plain line saying why a boot failed (ui17 job 17), so a handoff
    -- placeholder row can say what went wrong instead of a generic message.
    -- NULL unless boot_state is 'failed'.
    boot_error TEXT,
    isArchived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
`;

export const LAST_SCANNED_AT_SQL = `
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_at TIMESTAMP NULL
);
`;

export const APP_CONFIG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Persistent custom-model library used by the Providers module.
 *
 * Only user-created models are stored here. Predefined models remain source-
 * controlled in each provider's `-models.provider.ts` adapter so they can be
 * updated without migrating application data. `model_id` is unique only within
 * a provider because different CLIs can accept the same identifier.
 */
export const PROVIDER_MODELS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model_id)
);
`;

/**
 * Server-persisted composer drafts, one row per composer surface. `draft_key`
 * is a session id for open chats or `project:<projectId>` for the new-chat
 * composer, so no FK — keys outlive and predate session rows. `updated_at` is
 * written as an ISO string by the drafts route.
 */
/**
 * Watchdog chain and dispatched-run registries, persisted so a server restart
 * keeps reporting a stopped chain as stopped instead of falling back to
 * "finished". Chain runners and dispatched runs are external processes that
 * survive restarts, so rows are restored as-is; liveness is judged by events.
 * Timestamps are epoch milliseconds.
 */
export const WATCHDOG_CHAINS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS watchdog_chains (
    slug TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    phases INTEGER,
    current_phase INTEGER,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_event_at INTEGER NOT NULL,
    last_summary_tail TEXT,
    -- App-facing planner session that dispatched this chain. Immutable after
    -- the first registration; terminal wakes resolve forward through session
    -- predecessor links from this anchor.
    dispatching_session_id TEXT,
    -- Planner-supplied dispatch manifest (ui9 B4): JSON array of
    -- {name, tasks[], kind: 'phase'|'task', anchor?} in run order; NULL for
    -- chains dispatched without one. Appended units extend the array.
    manifest TEXT,
    -- Absolute path to the run's punch list file (ui11 phase 6); per-phase
    -- done counts are read from its checked-off boxes. NULL when not supplied.
    punchlist TEXT,
    -- Per-job metadata keyed by 1-based unit index (ui13 job 14): JSON object
    -- of {startedAt, endedAt, commitHash, commitSubject, taskTimes[]} — the
    -- jobs view's commit footer and duration data. NULL when none recorded.
    job_meta TEXT,
    -- 1 while a phase session is actually running (between phase-start and
    -- phase-end/terminal), so run state never reads from a stale session row.
    phase_active INTEGER NOT NULL DEFAULT 0,
    -- 1 from a terminal event (or liveness stop) until its planner wake is
    -- delivered (ui14 job 7); hydrate re-queues the wake for such chains.
    wake_pending INTEGER NOT NULL DEFAULT 0,
    -- Per-chain Codex fast-mode preference (ui17 job 13). The runner reads
    -- this before every build unit; verifier launches never inherit it.
    fast_mode INTEGER NOT NULL DEFAULT 0
);
`;

export const WATCHDOG_DISPATCH_RUNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS watchdog_dispatch_runs (
    session_id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    chain_slug TEXT,
    provider TEXT NOT NULL,
    model TEXT,
    started_at INTEGER NOT NULL,
    last_event_at INTEGER NOT NULL,
    stuck_wake_sent INTEGER NOT NULL DEFAULT 0,
    ended INTEGER NOT NULL DEFAULT 0
);
`;

export const COMPOSER_DRAFTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS composer_drafts (
    draft_key TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    attachments_json TEXT,
    updated_at TEXT NOT NULL
);
`;

/**
 * Per-user client preferences (ui11 phase 1): one row per localStorage key the
 * client syncs (theme, models, layout, tool settings ...). `value` is the exact
 * string the browser would hold in localStorage, so the client's boot cache
 * and the server never disagree on format. `updated_at` is an ISO string.
 */
export const USER_SETTINGS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
`;

/**
 * Server-persisted queued messages (ui11 phase 1; multi-message stack ui15
 * job 2): any number of rows per session, ordered by `position` (append
 * order). `id` is the client-generated message id, `session_id` the app
 * session key (no FK, keys predate session rows), `options_json` the
 * send-options snapshot taken at queue time, `attachments_json` the
 * uploaded-attachment descriptors.
 */
export const QUEUED_MESSAGES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS queued_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    options_json TEXT,
    attachments_json TEXT,
    position INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queued_messages_session ON queued_messages(session_id, position);
`;

/**
 * Edit-and-resend response versioning (ui9 B3). A resend is a fresh provider
 * turn appended to the Claude transcript — the JSONL is never touched. These
 * rows only record which turns are alternative versions of the same exchange
 * so the client can hide the non-selected ones (hidden, never deleted).
 * `group_id` is the transcript id of the original (version 1) user message;
 * `user_message_id` is null for resends — the client resolves it against the
 * transcript by prompt text and time.
 */
export const MESSAGE_VERSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS message_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    user_message_id TEXT,
    prompt_text TEXT NOT NULL,
    is_selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, group_id, version)
);
`;

/**
 * Memory-updated transcript indicators (ui12 phase 7). The server-side watcher
 * on the planner memory repo and native auto-memory paths records one row per
 * coalesced write burst, attributed to a session; the client merges these into
 * the transcript on reload (the provider JSONL is never touched).
 */
export const MEMORY_UPDATES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    files_json TEXT NOT NULL,
    diffs_json TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
);
`;

export const INIT_SCHEMA_SQL = `
-- Initialize authentication database
PRAGMA foreign_keys = ON;

${USER_TABLE_SCHEMA_SQL}
-- Indexes for performance for user lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

${API_KEYS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

${USER_CREDENTIALS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

${VAPID_KEYS_TABLE_SCHEMA_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

${NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled);

${PROJECTS_TABLE_SCHEMA_SQL}
-- NOTE: These indexes are created in migrations after legacy table-shape repairs.
-- Creating them here can fail on upgraded installs where projects lacks those columns.

${SESSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);
-- NOTE: This index is created in migrations after sessions is rebuilt to include project_path.
-- Creating it here can fail on upgraded installs where the legacy sessions table has no project_path.

${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}

${PROVIDER_MODELS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_provider_models_provider_order
ON provider_models(provider, sort_order, id);

${COMPOSER_DRAFTS_TABLE_SCHEMA_SQL}

${WATCHDOG_CHAINS_TABLE_SCHEMA_SQL}

${WATCHDOG_DISPATCH_RUNS_TABLE_SCHEMA_SQL}

${MESSAGE_VERSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_message_versions_session ON message_versions(session_id);

${MEMORY_UPDATES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_memory_updates_session ON memory_updates(session_id);
`;
