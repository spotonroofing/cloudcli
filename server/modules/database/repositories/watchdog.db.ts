import { getConnection } from '@/modules/database/connection.js';

export type WatchdogChainRow = {
  slug: string;
  project_path: string;
  phases: number | null;
  current_phase: number | null;
  status: string;
  started_at: number;
  last_event_at: number;
  last_summary_tail: string | null;
  /** App-facing planner session that originally dispatched the chain. */
  dispatching_session_id: string | null;
  /** Planner-supplied dispatch manifest as JSON (ui9 B4); NULL when absent. */
  manifest: string | null;
  /** 1 while a phase session is running (between phase-start and phase-end). */
  phase_active: number;
  /** Absolute path to the run's punch list file (ui11 phase 6); NULL when absent. */
  punchlist: string | null;
  /** Per-job commit/timing metadata as JSON (ui13 job 14); NULL when none. */
  job_meta: string | null;
  /** 1 while a terminal planner wake is queued but not yet delivered (ui14 job 7). */
  wake_pending: number;
  /** 1 when the next Codex build unit should use the fast service tier. */
  fast_mode: number;
  /** 1 while the runner owes a clean unit-boundary hold. */
  hold_requested: number;
  /** Machine-readable owner of the boundary hold; currently `promote`. */
  hold_reason: string | null;
};

export type WatchdogDispatchRunRow = {
  session_id: string;
  project_path: string;
  chain_slug: string | null;
  provider: string;
  model: string | null;
  started_at: number;
  last_event_at: number;
  stuck_wake_sent: number;
  ended: number;
};

/** One durable promote attempt, consumed by the watchdog routes and jobs history. */
type WatchdogPromoteRow = {
  id: number;
  project_path: string;
  promoted_at: number;
  started_at: number;
  ended_at: number | null;
  promoted_commit: string;
  previous_live_commit: string;
  dry_run: number;
  stage: string;
  status: string;
  log_path: string;
  failure_detail: string | null;
};

/**
 * Persistence behind the watchdog's in-memory chain and dispatched-run
 * registries. The service stays the runtime source of truth; every mutation
 * writes through here so a restart hydrates the same picture instead of
 * misreporting a stopped chain as finished.
 */
export const watchdogDb = {
  upsertChain(row: WatchdogChainRow): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO watchdog_chains (slug, project_path, phases, current_phase, status, started_at, last_event_at, last_summary_tail, dispatching_session_id, manifest, phase_active, punchlist, job_meta, wake_pending, fast_mode, hold_requested, hold_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        project_path = excluded.project_path,
        phases = excluded.phases,
        current_phase = excluded.current_phase,
        status = excluded.status,
        started_at = excluded.started_at,
        last_event_at = excluded.last_event_at,
        last_summary_tail = excluded.last_summary_tail,
        dispatching_session_id = COALESCE(watchdog_chains.dispatching_session_id, excluded.dispatching_session_id),
        manifest = excluded.manifest,
        phase_active = excluded.phase_active,
        punchlist = excluded.punchlist,
        job_meta = excluded.job_meta,
        wake_pending = excluded.wake_pending,
        fast_mode = excluded.fast_mode,
        hold_requested = excluded.hold_requested,
        hold_reason = excluded.hold_reason
    `).run(
      row.slug,
      row.project_path,
      row.phases,
      row.current_phase,
      row.status,
      row.started_at,
      row.last_event_at,
      row.last_summary_tail,
      row.dispatching_session_id,
      row.manifest,
      row.phase_active,
      row.punchlist,
      row.job_meta,
      row.wake_pending,
      row.fast_mode,
      row.hold_requested,
      row.hold_reason,
    );
  },

  listChains(): WatchdogChainRow[] {
    const db = getConnection();
    return db.prepare('SELECT * FROM watchdog_chains').all() as WatchdogChainRow[];
  },

  /**
   * Re-anchors one persisted chain after the watchdog proves its original
   * planner lineage is dead. The watchdog service is the sole consumer; the
   * normal upsert deliberately keeps the first dispatch anchor unchanged.
   */
  updateChainDispatchingSession(slug: string, sessionId: string): boolean {
    const db = getConnection();
    return db.prepare(
      'UPDATE watchdog_chains SET dispatching_session_id = ? WHERE slug = ?'
    ).run(sessionId, slug).changes > 0;
  },

  upsertDispatchRun(row: WatchdogDispatchRunRow): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO watchdog_dispatch_runs (session_id, project_path, chain_slug, provider, model, started_at, last_event_at, stuck_wake_sent, ended)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        project_path = excluded.project_path,
        chain_slug = excluded.chain_slug,
        provider = excluded.provider,
        model = excluded.model,
        started_at = excluded.started_at,
        last_event_at = excluded.last_event_at,
        stuck_wake_sent = excluded.stuck_wake_sent,
        ended = excluded.ended
    `).run(
      row.session_id,
      row.project_path,
      row.chain_slug,
      row.provider,
      row.model,
      row.started_at,
      row.last_event_at,
      row.stuck_wake_sent,
      row.ended,
    );
  },

  listDispatchRuns(): WatchdogDispatchRunRow[] {
    const db = getConnection();
    return db.prepare('SELECT * FROM watchdog_dispatch_runs').all() as WatchdogDispatchRunRow[];
  },

  /** Inserts an attempt before promote.sh runs its first gate. */
  createPromoteAttempt(row: Omit<WatchdogPromoteRow, 'id'>): number {
    const db = getConnection();
    const result = db.prepare(`
      INSERT INTO watchdog_promotes (
        project_path, promoted_at, started_at, ended_at, promoted_commit,
        previous_live_commit, dry_run, stage, status, log_path, failure_detail
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.project_path,
      row.promoted_at,
      row.started_at,
      row.ended_at,
      row.promoted_commit,
      row.previous_live_commit,
      row.dry_run,
      row.stage,
      row.status,
      row.log_path,
      row.failure_detail,
    );
    return Number(result.lastInsertRowid);
  },

  /** Advances one attempt owned by the same project, preserving its start. */
  updatePromoteAttempt(row: Omit<WatchdogPromoteRow, 'started_at'>): boolean {
    const db = getConnection();
    return db.prepare(`
      UPDATE watchdog_promotes
      SET promoted_at = ?, ended_at = ?, promoted_commit = ?, previous_live_commit = ?,
          dry_run = ?, stage = ?, status = ?, log_path = ?, failure_detail = ?
      WHERE id = ? AND project_path = ?
    `).run(
      row.promoted_at,
      row.ended_at,
      row.promoted_commit,
      row.previous_live_commit,
      row.dry_run,
      row.stage,
      row.status,
      row.log_path,
      row.failure_detail,
      row.id,
      row.project_path,
    ).changes > 0;
  },

  /** Lists one project's promote boundaries newest first for the watchdog route. */
  listPromotes(projectPath: string): WatchdogPromoteRow[] {
    const db = getConnection();
    return db.prepare(`
      SELECT id, project_path, promoted_at, started_at, ended_at, promoted_commit,
             previous_live_commit, dry_run, stage, status, log_path, failure_detail
      FROM watchdog_promotes
      WHERE project_path = ?
      ORDER BY promoted_at DESC, id DESC
    `).all(projectPath) as WatchdogPromoteRow[];
  },

  deleteDispatchRun(sessionId: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM watchdog_dispatch_runs WHERE session_id = ?').run(sessionId);
  },
};
