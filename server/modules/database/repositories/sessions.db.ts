import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

type SessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  /**
   * Effective project path: the app-owned assignment when present, else the
   * cwd-derived value the synchronizer maintains. Readers of session rows see
   * the effective value here (lists and feeds prefer the assignment).
   */
  project_path: string | null;
  /** Raw app-owned assignment; NULL when the session was never attached. */
  assigned_project_path: string | null;
  /**
   * 'direct' (worker pane) | 'dispatch' (chain runner) | 'planner' (project
   * chat) | 'external' (discovered on disk, not created through the app) |
   * null (ordinary chat).
   */
  origin: string | null;
  /** Project HEAD when the run began; feeds the pane's files-touched view. */
  base_commit: string | null;
  /** Dispatch chain slug the run belongs to; NULL for direct/free-standing runs. */
  chain_slug: string | null;
  /** 1-based unit index inside the dispatch chain; NULL outside chains. */
  chain_phase: number | null;
  /** App-facing id of the planner session this handoff/rotation replaced. */
  predecessor_session_id: string | null;
  /** 1 when this chat is the project's fallback watchdog wake destination. */
  watchdog_wake_target: number;
  /** 1 when the session's first message was an auto-sent boot prompt. */
  booted: number;
  /** NULL | 'pending' | 'ready' | 'failed' — persisted boot lifecycle. */
  boot_state: string | null;
  /** One plain line saying why a boot failed; NULL unless boot_state is 'failed'. */
  boot_error: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  /** Model this session runs with; NULL until the app records one for it. */
  model: string | null;
  /** Reasoning effort this session runs with; NULL until the app records one. */
  effort: string | null;
  /** 1/0 when this Codex session records a fast-mode choice; NULL until then. */
  fast_mode: number | null;
  isArchived: number;
  created_at: string;
  updated_at: string;
};

type RecentSessionsPage = {
  sessions: SessionRow[];
  total: number;
};

// `project_path` is surfaced as the effective value (assignment wins) so every
// list/feed reader prefers the app-owned attach-to-project choice without each
// call site repeating the COALESCE. Writes always name real columns explicitly.
const SESSION_ROW_COLUMNS =
  'session_id, provider, provider_session_id, COALESCE(assigned_project_path, project_path) AS project_path, assigned_project_path, origin, base_commit, chain_slug, chain_phase, predecessor_session_id, watchdog_wake_target, booted, boot_state, boot_error, jsonl_path, custom_name, model, effort, fast_mode, isArchived, created_at, updated_at';

// WHERE-clause form of the same preference (SQLite cannot reference SELECT
// aliases in WHERE).
const EFFECTIVE_PROJECT_PATH_SQL = 'COALESCE(assigned_project_path, project_path)';

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  // SQLite CURRENT_TIMESTAMP is stored as UTC without a timezone suffix.
  // Normalize it here so every session reader returns canonical ISO strings
  // and the sidebar never interprets fresh rows as local-time "hours old".
  const normalizedValue = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;

  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeSessionRow<T extends SessionRow | null | undefined>(row: T): T {
  if (!row) {
    return row;
  }

  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  };
}

function normalizeSessionRows(rows: SessionRow[]): SessionRow[] {
  return rows.map((row) => normalizeSessionRow(row) as SessionRow);
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
}

/**
 * Discovery never creates project rows: a project exists only because it was
 * created in the app. A discovered session keeps its cwd-derived project_path
 * only when that project row already exists (satisfying the FK); otherwise it
 * lands project-less and renders as a standalone chat.
 */
function resolveExistingProjectPath(normalizedProjectPath: string): string | null {
  return projectsDb.getProjectPath(normalizedProjectPath) ? normalizedProjectPath : null;
}

export const sessionsDb = {
  /**
   * Upserts one session row discovered on disk by a provider synchronizer.
   *
   * The given id is the provider-native session id. Rows are keyed by
   * `provider_session_id` so a session that was first created by the app
   * (with an app-allocated `session_id`) is updated in place once its
   * transcript shows up on disk, instead of producing a duplicate row. An
   * app-created row keeps its existing name; synchronizer names only update
   * rows that were themselves created by indexing provider storage.
   *
   * `origin` applies only when discovery itself creates the row: a row that
   * exists only because indexing found it on disk was not started through the
   * app, so it defaults to 'external' (a synchronizer with an honest
   * transcript marker for app-run sessions may pass null instead). Rows that
   * already exist keep whatever origin the app gave them.
   */
  createSession(
    providerSessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null,
    origin: string | null = 'external'
  ): string {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const effectiveProjectPath = resolveExistingProjectPath(normalizedProjectPath);

    const existing = db
      .prepare(
        `SELECT session_id FROM sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { session_id: string } | undefined;

    if (existing) {
      // A missing timestamp keeps the row's current value (ui14 job 12): a
      // re-index that could not read a real timestamp must never restamp an
      // old chat to "now".
      db.prepare(
        `UPDATE sessions SET
           provider = ?,
           updated_at = COALESCE(?, updated_at),
           project_path = ?,
           jsonl_path = ?,
           isArchived = 0,
           custom_name = CASE
             WHEN session_id <> provider_session_id AND custom_name IS NOT NULL THEN custom_name
             ELSE COALESCE(?, custom_name)
           END
         WHERE session_id = ?`
      ).run(
        provider,
        updatedAtValue,
        effectiveProjectPath,
        jsonlPath ?? null,
        customName ?? null,
        existing.session_id
      );

      return existing.session_id;
    }

    // Sessions created outside the app (directly via the provider CLI) are
    // keyed by the provider-native id for both columns. The ON CONFLICT path
    // covers legacy rows that predate the provider_session_id mapping.
    // `origin` is set only on the freshly inserted row; the conflict path hits
    // an already-known row whose origin the app owns.
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, origin, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         updated_at = COALESCE(?, sessions.updated_at),
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         isArchived = 0,
         custom_name = CASE
           WHEN sessions.session_id <> sessions.provider_session_id AND sessions.custom_name IS NOT NULL
             THEN sessions.custom_name
           ELSE COALESCE(excluded.custom_name, sessions.custom_name)
         END`
    ).run(
      providerSessionId,
      provider,
      providerSessionId,
      customName ?? null,
      effectiveProjectPath,
      origin,
      jsonlPath ?? null,
      createdAtValue,
      updatedAtValue,
      // The conflict path re-binds the timestamp so a null keeps the row's
      // current updated_at instead of taking the insert's CURRENT_TIMESTAMP.
      updatedAtValue
    );

    return providerSessionId;
  },

  /**
   * Inserts one app-allocated session row before any provider run happens.
   *
   * The session gateway uses this when the frontend starts a brand-new chat:
   * `session_id` is the stable app-facing id, while `provider_session_id`
   * stays NULL until the provider runtime announces its own id and
   * `assignProviderSessionId` records the mapping. `customName` is derived
   * from the first visible Command Center message by the sessions service.
   */
  createAppSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    origin?: string | null,
    baseCommit?: string | null,
  ): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, origin, base_commit, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(sessionId, provider, customName ?? null, normalizedProjectPath, origin ?? null, baseCommit ?? null);

    // The first interactive chat in a project becomes its initial wake target.
    // Later side chats cannot steal it because this only fills an empty slot.
    if (origin == null || origin === 'planner') {
      db.prepare(
        `UPDATE sessions
         SET watchdog_wake_target = 1
         WHERE session_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM sessions target
             WHERE COALESCE(target.assigned_project_path, target.project_path) = ?
               AND target.watchdog_wake_target = 1
               AND target.session_id <> ?
           )`
      ).run(sessionId, normalizedProjectPath, sessionId);
    }

    return sessionId;
  },

  /**
   * Tags a session with its worker origin (and optionally the base commit,
   * chain slug, and the model the run was dispatched with) after the fact —
   * used by the external run surface, which only learns the session id once
   * the provider announces it.
   *
   * A fast run can end before the filesystem watcher has indexed its
   * transcript, so when `upsertContext` is given and no row matches, a row is
   * inserted (keyed by the provider-native id) that the watcher's later
   * upsert updates in place — otherwise the tag would be lost and the run
   * invisible to the worker pane.
   */
  setSessionOrigin(
    sessionId: string,
    origin: string,
    baseCommit?: string | null,
    chainSlug?: string | null,
    model?: string | null,
    upsertContext?: { provider: string; projectPath: string },
    chainPhase?: number | null,
    title?: string | null,
  ): void {
    const db = getConnection();
    // The announced title (codex job 5: the prompt file's name header) is
    // authoritative — it replaces anything discovery derived from the prompt.
    const result = db.prepare(
      `UPDATE sessions
       SET origin = ?,
           base_commit = COALESCE(?, base_commit),
           chain_slug = COALESCE(?, chain_slug),
           chain_phase = COALESCE(?, chain_phase),
           model = COALESCE(?, model),
           custom_name = COALESCE(?, custom_name)
       WHERE session_id = ? OR provider_session_id = ?`
    ).run(origin, baseCommit ?? null, chainSlug ?? null, chainPhase ?? null, model ?? null, title ?? null, sessionId, sessionId);

    if (result.changes > 0 || !upsertContext) {
      return;
    }

    const effectiveProjectPath = resolveExistingProjectPath(normalizeProjectPath(upsertContext.projectPath));
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, origin, base_commit, chain_slug, chain_phase, model, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(sessionId, upsertContext.provider, sessionId, title ?? null, effectiveProjectPath, origin, baseCommit ?? null, chainSlug ?? null, chainPhase ?? null, model ?? null);
  },

  /**
   * The most recent planner-lane session for a project: prefers sessions
   * explicitly tagged 'planner', falls back to the newest untagged interactive
   * session. Boot prologues and rotation sweeps use this recency helper;
   * watchdog wake delivery uses resolveWatchdogWakeSession instead.
   */
  getLatestPlannerSession(projectPath: string): SessionRow | null {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const pick = (originClause: string): SessionRow | undefined =>
      db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS}
           FROM sessions
           WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
             AND ${originClause}
             AND isArchived = 0
           ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
           LIMIT 1`
        )
        .get(normalizedProjectPath) as SessionRow | undefined;

    const row = pick(`origin = 'planner'`) ?? pick('origin IS NULL');
    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Makes one active project chat the fallback for watchdog wakes that carry
   * no chain lineage. The clear-and-set transaction preserves one target per
   * project and deliberately does not touch session activity timestamps.
   */
  setWatchdogWakeTarget(sessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE (session_id = ? OR provider_session_id = ?)
           AND isArchived = 0
           AND (origin = 'planner' OR origin IS NULL)
         LIMIT 1`
      )
      .get(sessionId, sessionId) as SessionRow | undefined;
    const normalizedRow = normalizeSessionRow(row) ?? null;
    if (!normalizedRow?.project_path) {
      return null;
    }

    const moveTarget = db.transaction((targetId: string, projectPath: string) => {
      db.prepare(
        `UPDATE sessions
         SET watchdog_wake_target = 0
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND watchdog_wake_target <> 0`
      ).run(projectPath);
      db.prepare('UPDATE sessions SET watchdog_wake_target = 1 WHERE session_id = ?').run(targetId);
    });
    moveTarget(normalizedRow.session_id, normalizeProjectPath(normalizedRow.project_path));
    return sessionsDb.getSessionById(normalizedRow.session_id);
  },

  /** Records a spawned planner's predecessor without changing chat recency. */
  setSessionPredecessor(sessionId: string, predecessorSessionId: string): boolean {
    const db = getConnection();
    const result = db.prepare(
      `UPDATE sessions
       SET predecessor_session_id = ?
       WHERE session_id = ? OR provider_session_id = ?`
    ).run(predecessorSessionId, sessionId, sessionId);
    return result.changes > 0;
  },

  /**
   * Resolves a chain wake for the watchdog module and reports whether its
   * dispatch lineage was exhausted. A successful handoff ends its predecessor
   * even when the successor was later archived; only a failed handoff leaves
   * the predecessor open. The dead-lineage fallback is deliberately narrower
   * than ordinary chat selection: newest ready `origin = planner` row that
   * actually booted through /planner, never an unbooted side chat.
   */
  resolveWatchdogWakeTarget(
    projectPath: string,
    dispatchingSessionId: string | null = null,
  ): { session: SessionRow | null; usedFallback: boolean } {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const selectManualTarget = (): SessionRow | null => {
      const target = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS}
           FROM sessions
           WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
             AND watchdog_wake_target = 1
             AND isArchived = 0
             AND (origin = 'planner' OR origin IS NULL)
             AND COALESCE(boot_state, 'ready') <> 'failed'
           ORDER BY session_id DESC
           LIMIT 1`
        )
        .get(normalizedProjectPath) as SessionRow | undefined;
      return normalizeSessionRow(target) ?? null;
    };

    const selectLivePlannerFallback = (): SessionRow | null => {
      const target = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS}
           FROM sessions
           WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
             AND origin = 'planner'
             AND booted = 1
             AND isArchived = 0
             AND COALESCE(boot_state, 'ready') = 'ready'
           ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
           LIMIT 1`
        )
        .get(normalizedProjectPath) as SessionRow | undefined;
      return normalizeSessionRow(target) ?? null;
    };

    if (!dispatchingSessionId) {
      return { session: selectManualTarget(), usedFallback: false };
    }

    let current = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND (session_id = ? OR provider_session_id = ?)
         LIMIT 1`
      )
      .get(normalizedProjectPath, dispatchingSessionId, dispatchingSessionId) as SessionRow | undefined;
    if (!current) {
      return { session: selectLivePlannerFallback(), usedFallback: true };
    }

    const visited = new Set<string>();
    while (current && !visited.has(current.session_id)) {
      visited.add(current.session_id);
      // Include archived successors while walking: their existence proves
      // the predecessor completed a handoff and must not be resumed. A failed
      // reservation is excluded because its predecessor remained active.
      const successor = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS}
           FROM sessions
           WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
             AND predecessor_session_id = ?
             AND COALESCE(boot_state, 'ready') <> 'failed'
           ORDER BY datetime(COALESCE(created_at, updated_at)) DESC, session_id DESC
           LIMIT 1`
        )
        .get(normalizedProjectPath, current.session_id) as SessionRow | undefined;
      if (!successor) {
        break;
      }
      current = successor;
    }

    const resolved = normalizeSessionRow(current) ?? null;
    if (resolved && resolved.isArchived === 0 && resolved.boot_state !== 'failed') {
      return { session: resolved, usedFallback: false };
    }
    return { session: selectLivePlannerFallback(), usedFallback: true };
  },

  /**
   * Compatibility view consumed by existing watchdog, handoff, and database
   * callers that only need the selected session row.
   */
  resolveWatchdogWakeSession(projectPath: string, dispatchingSessionId: string | null = null): SessionRow | null {
    return sessionsDb.resolveWatchdogWakeTarget(projectPath, dispatchingSessionId).session;
  },

  /**
   * Newest unarchived session of one origin in a project that recorded a
   * model or effort, skipping one id: the spawn paths read the row a new
   * planner or direct worker inherits its selection from (the last pick,
   * never a row that booted and recorded nothing), excluding the session
   * being spawned.
   */
  getLatestSessionByOrigin(
    projectPath: string,
    origin: 'planner' | 'direct',
    excludeSessionId: string | null,
  ): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND origin = ?
           AND isArchived = 0
           AND session_id <> ?
           AND (model IS NOT NULL OR effort IS NOT NULL)
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`
      )
      .get(normalizeProjectPath(projectPath), origin, excludeSessionId ?? '') as SessionRow | undefined;
    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Latest explicitly-tagged planner session per project (rotation sweep).
   */
  listPlannerSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE session_id IN (
           SELECT session_id FROM sessions s2
           WHERE s2.origin = 'planner' AND s2.isArchived = 0
             AND datetime(COALESCE(s2.updated_at, s2.created_at)) = (
               SELECT MAX(datetime(COALESCE(s3.updated_at, s3.created_at)))
               FROM sessions s3
               WHERE s3.origin = 'planner' AND s3.isArchived = 0
                 AND COALESCE(s3.assigned_project_path, s3.project_path) = COALESCE(s2.assigned_project_path, s2.project_path)
             )
         )`
      )
      .all() as SessionRow[];
    return normalizeSessionRows(rows);
  },

  /**
   * Active and recent worker sessions (origin direct, dispatch, external, or
   * maintenance) for a project, newest first. Feeds the worker pane's run
   * switcher; terminal-launched runs ('external') and Monday maintenance runs
   * surface here rather than as chats.
   */
  listWorkerSessions(projectPath: string, limit: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND origin IN ('direct', 'dispatch', 'external', 'maintenance')
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ?`
      )
      .all(normalizedProjectPath, limit) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Every session announced for a dispatch chain, any stage (codex job 5):
   * the watchdog reads a running unit's build and verify sessions off these
   * rows for the running-sessions poll.
   */
  listChainSessions(chainSlug: string): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE chain_slug = ?
           AND isArchived = 0`
      )
      .all(chainSlug) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Records the provider-native session id for one app-allocated session.
   *
   * If the filesystem watcher indexed the provider transcript before this
   * mapping was recorded (a duplicate row keyed by the provider id exists),
   * the duplicate is merged into the app row: its transcript path and name
   * are adopted and the duplicate row is removed. Runs in a transaction so
   * the sidebar can never observe both rows at once.
   */
  assignProviderSessionId(sessionId: string, providerSessionId: string): void {
    const db = getConnection();

    const merge = db.transaction(() => {
      const duplicate = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS} FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?
           LIMIT 1`
        )
        .get(providerSessionId, providerSessionId, sessionId) as SessionRow | undefined;

      // Identity wiring never touches updated_at (ui14 job 12): a resumed run
      // re-announcing its provider id is not chat activity, and restamping
      // here made old chats read as just-updated.
      if (duplicate) {
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(duplicate.session_id);
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             jsonl_path = COALESCE(jsonl_path, ?),
             custom_name = COALESCE(custom_name, ?)
           WHERE session_id = ?`
        ).run(providerSessionId, duplicate.jsonl_path, duplicate.custom_name, sessionId);
        return;
      }

      db.prepare(
        `UPDATE sessions SET
           provider_session_id = ?
         WHERE session_id = ?`
      ).run(providerSessionId, sessionId);
    });

    merge();
  },

  /**
   * Attaches one session to a project (or detaches with null).
   *
   * Writes only the app-owned `assigned_project_path`; the cwd-derived
   * `project_path` stays untouched so a filesystem rescan can never revert an
   * explicit assignment.
   */
  assignSessionToProject(sessionId: string, projectPath: string | null): void {
    const db = getConnection();
    const normalizedProjectPath = projectPath ? normalizeProjectPath(projectPath) : null;

    if (normalizedProjectPath) {
      projectsDb.createProjectPath(normalizedProjectPath);
    }

    // Moving a chat between projects keeps its age (ui14 job 12): the
    // timestamp reflects the last real message only.
    db.prepare(
      `UPDATE sessions
       SET assigned_project_path = ?
       WHERE session_id = ?`
    ).run(normalizedProjectPath, sessionId);
  },

  /**
   * Re-points every session from one project path to another (ui8 phase 3:
   * the project edit dialog can change a project's path; its sessions follow
   * so they stay attached to the project row).
   */
  repointProjectPath(previousPath: string, nextPath: string): void {
    const db = getConnection();
    const normalizedPrevious = normalizeProjectPath(previousPath);
    const normalizedNext = normalizeProjectPath(nextPath);
    db.prepare(
      `UPDATE sessions
       SET project_path = ?
       WHERE project_path = ?`
    ).run(normalizedNext, normalizedPrevious);
    db.prepare(
      `UPDATE sessions
       SET assigned_project_path = ?
       WHERE assigned_project_path = ?`
    ).run(normalizedNext, normalizedPrevious);
  },

  /**
   * Records the model one session runs with.
   *
   * Called both when the user picks a model for the session and on every send,
   * so the row always reflects what the session last ran with and reopening it
   * restores that model instead of a catalog default.
   */
  setSessionModel(sessionId: string, model: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET model = ?
       WHERE session_id = ?`
    ).run(model, sessionId);
  },

  /**
   * Records the reasoning effort one session runs with.
   *
   * `default` is stored as an explicit choice rather than NULL so reopening
   * the session does not inherit a later per-provider effort preference.
   */
  setSessionEffort(sessionId: string, effort: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET effort = ?
       WHERE session_id = ?`
    ).run(effort, sessionId);
  },

  /**
   * Records whether this Codex session uses the fast service tier.
   *
   * Both on and off are explicit values so reopening the session never falls
   * through to a provider default that may have changed in the meantime.
   */
  setSessionFastMode(sessionId: string, enabled: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET fast_mode = ?
       WHERE session_id = ?`
    ).run(enabled ? 1 : 0, sessionId);
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
  },

  /** Marks a session as boot-started (its first message was an auto-sent boot prompt). */
  markSessionBooted(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET booted = 1, boot_state = 'pending', boot_error = NULL
       WHERE session_id = ?`
    ).run(sessionId);
  },

  /**
   * Records the boot turn's outcome ('ready' or 'failed'). A failure may carry
   * one plain line saying what went wrong (ui17 job 17): the handoff placeholder
   * row shows it instead of the generic "failed to start" text, and it survives a
   * reload. A 'ready' boot clears any line an earlier attempt left.
   */
  setSessionBootState(sessionId: string, state: 'ready' | 'failed', bootError: string | null = null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET boot_state = ?, boot_error = ?
       WHERE session_id = ?`
    ).run(state, state === 'failed' ? bootError : null, sessionId);
  },

  /**
   * Server-start sweep: a boot that was mid-flight when the server died can
   * never complete — its SDK run lived in this process. Persisting the failure
   * is what stops a restart from reopening an aborted boot as a plain chat.
   */
  failPendingBoots(): number {
    const db = getConnection();
    const result = db.prepare(
      `UPDATE sessions
       SET boot_state = 'failed'
       WHERE boot_state = 'pending'`
    ).run();
    return result.changes;
  },

  getSessionById(sessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Resolves one session row through the provider-native id.
   *
   * The filesystem watcher only knows provider ids (they come from transcript
   * file names), so it uses this lookup to translate disk artifacts back to
   * the app-facing session row before broadcasting sidebar updates.
   */
  getSessionByProviderSessionId(providerSessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider_session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(providerSessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Finds the newest app-created session for a project that is still waiting
   * for its provider-native id to be recorded.
   *
   * Primary intention: OpenCode can expose a new session in its shared
   * `opencode.db` before the websocket runtime reports that same provider id
   * back to our app. At that moment the sidebar already has an optimistic
   * app-owned session row, but the watcher only knows the provider-native id.
   *
   * Without this lookup, the synchronizer would insert a second row keyed by
   * the provider id, then `assignProviderSessionId()` would merge it a moment
   * later. That eventually self-heals, but on slow networks the user can still
   * briefly see two sidebar sessions for the same conversation.
   *
   * This helper lets the synchronizer claim the pending app row first, so the
   * provider id is attached before any watcher-created row exists. The result
   * is simpler than frontend dedupe and keeps the race resolved at the source.
   */
  findLatestPendingAppSession(provider: string, projectPath: string): SessionRow | null {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider = ?
           AND project_path = ?
           AND provider_session_id IS NULL
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`
      )
      .get(provider, normalizedProjectPath) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Returns one globally ordered page of visible conversations.
   *
   * Pagination happens after archived sessions and sessions belonging to an
   * archived project have been excluded. This keeps the sidebar feed complete
   * and correctly ordered across projects instead of flattening only the
   * per-project slices already loaded by the client.
   */
  getRecentSessionsPage(limit: number, offset: number, projectId: string | null = null): RecentSessionsPage {
    const db = getConnection();
    // Optional projectId narrows the feed to one project (scoped desktop tabs);
    // pagination and totals then reflect only that project's sessions.
    // Only conversations the user started in the UI appear: origin NULL
    // (scratch/standalone chats) or 'planner' (project New Session chats).
    // Machine-started runs — 'direct' (worker pane), 'dispatch' (chain runner
    // / watchdog), and 'external' (terminal-launched, discovered on disk) —
    // stay in the worker pane surfaces.
    const visibilityClause = `
      sessions.isArchived = 0
      AND (projects.isArchived IS NULL OR projects.isArchived = 0)
      AND (sessions.origin IS NULL OR sessions.origin = 'planner')
      ${projectId ? 'AND projects.project_id = ?' : ''}
    `;
    const filterParams = projectId ? [projectId] : [];
    const rows = db
      .prepare(
        `SELECT sessions.session_id, sessions.provider, sessions.provider_session_id,
                COALESCE(sessions.assigned_project_path, sessions.project_path) AS project_path,
                sessions.assigned_project_path, sessions.origin, sessions.base_commit,
                sessions.chain_slug, sessions.chain_phase, sessions.predecessor_session_id,
                sessions.watchdog_wake_target, sessions.booted, sessions.boot_state, sessions.boot_error,
                sessions.jsonl_path, sessions.custom_name,
                sessions.model, sessions.effort, sessions.fast_mode, sessions.isArchived, sessions.created_at, sessions.updated_at
         FROM sessions
         LEFT JOIN projects ON projects.project_path = COALESCE(sessions.assigned_project_path, sessions.project_path)
         WHERE ${visibilityClause}
         ORDER BY julianday(COALESCE(sessions.updated_at, sessions.created_at)) DESC,
                  sessions.session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...filterParams, limit, offset) as SessionRow[];
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         LEFT JOIN projects ON projects.project_path = COALESCE(sessions.assigned_project_path, sessions.project_path)
         WHERE ${visibilityClause}`
      )
      .get(...filterParams) as { count: number } | undefined;

    return {
      sessions: normalizeSessionRows(rows),
      total: Number(countRow?.count ?? 0),
    };
  },

  /**
   * Archived rows are intentionally queried separately so the caller can render
   * them in a dedicated view without reintroducing them into active session lists.
   */
  getArchivedSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND isArchived = 0`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Permanent project deletion must see every session row for the path,
   * including archived ones, so their transcript files can be cleaned up.
   */
  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  // Project chat lists show only conversations the user started in the UI:
  // origin NULL or 'planner'. Machine-started runs ('direct', 'dispatch',
  // 'external') belong to the worker pane's run switcher, not the chat list.
  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND isArchived = 0
           AND (origin IS NULL OR origin = 'planner')
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?
           AND isArchived = 0
           AND (origin IS NULL OR origin = 'planner')`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    db.prepare(`DELETE FROM sessions WHERE ${EFFECTIVE_PROJECT_PATH_SQL} = ?`).run(normalizedProjectPath);
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`
      )
      .get(sessionId, provider) as { custom_name: string | null } | undefined;

    return row?.custom_name ?? null;
  },

  /**
   * Soft-delete and restore both use the same flag update so callers keep the
   * row, metadata, and file path intact while toggling visibility.
   */
  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`
    ).run(isArchived ? 1 : 0, sessionId);
  },

  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
  },
};
