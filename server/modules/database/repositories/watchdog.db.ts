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
  /** Planner-supplied dispatch manifest as JSON (ui9 B4); NULL when absent. */
  manifest: string | null;
  /** 1 while a phase session is running (between phase-start and phase-end). */
  phase_active: number;
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
      INSERT INTO watchdog_chains (slug, project_path, phases, current_phase, status, started_at, last_event_at, last_summary_tail, manifest, phase_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        project_path = excluded.project_path,
        phases = excluded.phases,
        current_phase = excluded.current_phase,
        status = excluded.status,
        started_at = excluded.started_at,
        last_event_at = excluded.last_event_at,
        last_summary_tail = excluded.last_summary_tail,
        manifest = excluded.manifest,
        phase_active = excluded.phase_active
    `).run(
      row.slug,
      row.project_path,
      row.phases,
      row.current_phase,
      row.status,
      row.started_at,
      row.last_event_at,
      row.last_summary_tail,
      row.manifest,
      row.phase_active,
    );
  },

  listChains(): WatchdogChainRow[] {
    const db = getConnection();
    return db.prepare('SELECT * FROM watchdog_chains').all() as WatchdogChainRow[];
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

  deleteDispatchRun(sessionId: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM watchdog_dispatch_runs WHERE session_id = ?').run(sessionId);
  },
};
