import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appConfigDb, projectsDb, sessionsDb, watchdogDb } from '@/modules/database/index.js';
import { PLANNER_MEMORY_ROOT } from '@/modules/memory/index.js';
import { providerRuntimeService, providerTokenUsageService, sessionsService } from '@/modules/providers/index.js';
import { sendFleetNotification } from '@/modules/notifications/index.js';
import { normalizeProjectPath } from '@/shared/utils.js';
import { WS_OPEN_STATE, chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

import { findUnpushedHandoff } from './handoff-push.js';

type ChainStatus = 'running' | 'completed' | 'stopped' | 'failed';

/**
 * One unit of a dispatch manifest (ui9 B4), in run order. `kind` 'phase' is a
 * full compiled unit; 'task' is a small appended iteration and renders as a
 * lighter row. `tasks` is the planner's concise per-phase task list.
 */
export type ChainManifestEntry = {
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  /**
   * Heading anchor of this unit's section in the run's punch list file
   * (ui11 phase 6): a substring of the section's markdown heading, so the
   * done count is read from exactly that section's checked boxes.
   */
  anchor?: string;
};

/**
 * Per-job commit and timing metadata (ui13 job 14), keyed by 1-based unit
 * index on the chain record. Timestamps are epoch ms. `taskTimes[i]` is when
 * the watchdog observed task i checked off in the punch list; null marks a
 * check-off whose time is unknown (observed while the unit was not live).
 */
export type ChainJobMeta = {
  startedAt?: number;
  endedAt?: number;
  commitHash?: string;
  commitSubject?: string;
  taskTimes?: (number | null)[];
};

type ChainRecord = {
  slug: string;
  projectPath: string;
  phases: number | null;
  currentPhase: number | null;
  status: ChainStatus;
  startedAt: number;
  lastEventAt: number;
  lastSummaryTail: string | null;
  /** Planner-supplied manifest; appended units extend it. NULL when absent. */
  manifest: ChainManifestEntry[] | null;
  /** True between phase-start and phase-end/terminal — a session is live. */
  phaseActive: boolean;
  /** Absolute path to the run's punch list file; null when not supplied. */
  punchlist: string | null;
  /** Per-job commit/timing metadata by 1-based unit index (ui13 job 14). */
  jobs: Record<number, ChainJobMeta>;
  /**
   * True from a terminal event (or a liveness stop) until the planner wake it
   * queued is delivered (ui14 job 7): hydrate re-queues the wake for chains
   * whose server restarted in between.
   */
  wakePending: boolean;
};

type DispatchRunRecord = {
  sessionId: string;
  projectPath: string;
  chainSlug: string | null;
  provider: string;
  /** Model the run was dispatched with; null when the caller left it to the SDK default. */
  model: string | null;
  startedAt: number;
  lastEventAt: number;
  stuckWakeSent: boolean;
  ended: boolean;
};

/**
 * One row of the worker pane's run switcher: a worker session (or a live
 * dispatched run the synchronizer has not indexed yet) with its honest state.
 */
type WorkerRun = {
  sessionId: string;
  provider: string;
  origin: string | null;
  /** True when the run's first message was an auto-sent boot prompt. */
  booted: boolean;
  chainSlug: string | null;
  /** 1-based unit index inside the dispatch chain; null outside chains. */
  chainPhase: number | null;
  title: string | null;
  state: 'running' | 'finished' | 'stopped';
  model: string | null;
  lastActivity: string | null;
};

/** Chain snapshot the worker pane's phase navigator renders from. */
type ChainSnapshot = {
  slug: string;
  projectPath: string;
  status: ChainStatus;
  phases: number | null;
  currentPhase: number | null;
  phaseActive: boolean;
  /** Manifest entries with the punch-list `done` count and the unit's commit
   *  and timing metadata (ui13 job 14) folded in per unit. */
  manifest: (ChainManifestEntry & { done: number | null } & ChainJobMeta)[] | null;
  startedAt: number;
  lastEventAt: number;
};

type WakeItem = {
  prompt: string;
  /** Always boots a brand-new planner session instead of resuming. */
  freshBoot?: boolean;
  /** Chain whose wakePending flag this wake clears once delivered. */
  chainSlug?: string;
  /** Consecutive delivery failures; the fallback fires at WAKE_MAX_FAILURES. */
  failures: number;
};

type WakeQueue = {
  prompts: WakeItem[];
  draining: boolean;
};

const STUCK_SILENCE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const WAKE_RETRY_MS = 60 * 1000;
const WAKE_MAX_FAILURES = 3;
/** A live phase with no runner event and no journal/transcript writes this long is wedged. */
const CHAIN_WEDGE_MS = Number(process.env.WATCHDOG_CHAIN_WEDGE_MS || 3 * 60 * 60 * 1000);
/** Debounce for punch-list writes (ui14 job 8): editors save in bursts. */
const PUNCHLIST_DEBOUNCE_MS = 250;
const RESOURCE_ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;
const MIN_FREE_DISK_GB = Number(process.env.WATCHDOG_MIN_FREE_DISK_GB || 10);
const MIN_FREE_MEM_PCT = Number(process.env.WATCHDOG_MIN_FREE_MEM_PCT || 10);

const log = (message: string, meta?: Record<string, unknown>) => {
  console.log(`[Watchdog] ${message}`, meta ?? '');
};

/**
 * Watchdog + scheduler module (spec B3): monitors dispatched runs and chains
 * at zero planner-token cost, wakes the project's planner on boundaries,
 * escalates decision-needed events, and self-tests the push pipeline weekly.
 * Direct (origin=direct) sessions are Willem's own and are never touched.
 */
class WatchdogService {
  private chains = new Map<string, ChainRecord>();
  private rotatedSessions = new Set<string>();
  private dispatchRuns = new Map<string, DispatchRunRecord>();
  private wakeQueues = new Map<string, WakeQueue>();
  private resourceAlertAt = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private selfTestTimer: ReturnType<typeof setTimeout> | null = null;
  /** One directory watcher per running chain with a punch list (ui14 job 8). */
  private punchlistWatchers = new Map<string, { watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null; mtimeMs: number }>();

  start(): void {
    if (this.sweeper) {
      return;
    }
    this.hydrateFromDb();
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
    this.scheduleWeeklySelfTest();
    this.scheduleWeeklyMaintenance();
    log('started (sweep every 5m, weekly self-test scheduled)');
  }

  /**
   * Restores both registries from the DB at startup. Chain runners and
   * dispatched runs are external processes that survive a server restart, so
   * records come back exactly as last known — a live run keeps posting events
   * and stays current; a dead one is caught by the stuck sweep. What this
   * fixes: a stopped/failed chain no longer reads "finished" after a restart.
   */
  private hydrateFromDb(): void {
    try {
      for (const row of watchdogDb.listChains()) {
        this.chains.set(row.slug, {
          slug: row.slug,
          projectPath: row.project_path,
          phases: row.phases,
          currentPhase: row.current_phase,
          status: row.status as ChainStatus,
          startedAt: row.started_at,
          lastEventAt: row.last_event_at,
          lastSummaryTail: row.last_summary_tail,
          manifest: parseManifest(row.manifest),
          phaseActive: Boolean(row.phase_active),
          punchlist: row.punchlist,
          jobs: parseJobMeta(row.job_meta),
          wakePending: Boolean(row.wake_pending),
        });
      }
      for (const row of watchdogDb.listDispatchRuns()) {
        this.dispatchRuns.set(row.session_id, {
          sessionId: row.session_id,
          projectPath: row.project_path,
          chainSlug: row.chain_slug,
          provider: row.provider,
          model: row.model,
          startedAt: row.started_at,
          lastEventAt: row.last_event_at,
          stuckWakeSent: Boolean(row.stuck_wake_sent),
          ended: Boolean(row.ended),
        });
      }
      if (this.chains.size || this.dispatchRuns.size) {
        log(`hydrated from DB: ${this.chains.size} chain(s), ${this.dispatchRuns.size} dispatched run(s)`);
      }
      for (const chain of this.chains.values()) {
        this.syncPunchlistWatcher(chain);
      }
      // A terminal wake that was queued but never delivered before the last
      // restart (the queue is in-memory) is re-derived from the chain record.
      for (const chain of this.chains.values()) {
        if (chain.status !== 'running' && chain.wakePending) {
          log(`chain ${chain.slug}: re-deriving its undelivered ${chain.status} wake after restart`);
          this.queueWake(chain.projectPath, terminalWakePrompt(chain), { chainSlug: chain.slug });
        }
      }
    } catch (error) {
      log(`hydration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persistChain(chain: ChainRecord): void {
    try {
      watchdogDb.upsertChain({
        slug: chain.slug,
        project_path: chain.projectPath,
        phases: chain.phases,
        current_phase: chain.currentPhase,
        status: chain.status,
        started_at: chain.startedAt,
        last_event_at: chain.lastEventAt,
        last_summary_tail: chain.lastSummaryTail,
        manifest: chain.manifest ? JSON.stringify(chain.manifest) : null,
        phase_active: chain.phaseActive ? 1 : 0,
        punchlist: chain.punchlist,
        job_meta: Object.keys(chain.jobs).length ? JSON.stringify(chain.jobs) : null,
        wake_pending: chain.wakePending ? 1 : 0,
      });
    } catch (error) {
      log(`chain persist failed for ${chain.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persistDispatchRun(run: DispatchRunRecord): void {
    try {
      watchdogDb.upsertDispatchRun({
        session_id: run.sessionId,
        project_path: run.projectPath,
        chain_slug: run.chainSlug,
        provider: run.provider,
        model: run.model,
        started_at: run.startedAt,
        last_event_at: run.lastEventAt,
        stuck_wake_sent: run.stuckWakeSent ? 1 : 0,
        ended: run.ended ? 1 : 0,
      });
    } catch (error) {
      log(`run persist failed for ${run.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- chain registry (populated by the dispatch CLI, spec B4) -----

  registerChain(input: {
    slug: string;
    projectPath: string;
    phases?: number | null;
    manifest?: ChainManifestEntry[] | null;
    punchlist?: string | null;
  }): void {
    // A re-registration (restart-recovery via an event) without a manifest
    // keeps the one the chain already has; same for the punch list path.
    const existing = this.chains.get(input.slug);
    const punchlist = input.punchlist
      ? path.isAbsolute(input.punchlist)
        ? input.punchlist
        : path.join(input.projectPath, input.punchlist)
      : existing?.punchlist ?? null;
    const chain: ChainRecord = {
      slug: input.slug,
      projectPath: input.projectPath,
      phases: input.phases ?? null,
      currentPhase: null,
      status: 'running',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      lastSummaryTail: null,
      manifest: input.manifest ?? existing?.manifest ?? null,
      phaseActive: false,
      punchlist,
      jobs: existing?.jobs ?? {},
      wakePending: false,
    };
    this.chains.set(input.slug, chain);
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain registered: ${input.slug}`, { projectPath: input.projectPath, phases: input.phases ?? null });
  }

  /**
   * Replaces a chain's manifest in place (ui13 job 13): label edits mid-run
   * must not go through registerChain, which resets currentPhase/startedAt/
   * phaseActive. Everything except the manifest is left untouched.
   */
  updateChainManifest(slug: string, manifest: ChainManifestEntry[]): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    chain.manifest = manifest;
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: manifest updated in place (${manifest.length} entries)`);
    return true;
  }

  /**
   * Merges per-job commit/timing metadata into a chain (ui13 job 14): the
   * backfill path for jobs whose phase-end event predates the commit-carrying
   * runner. Supplied fields overwrite per job; untouched jobs keep theirs.
   */
  updateChainJobs(slug: string, jobs: Record<number, ChainJobMeta>): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    for (const [index, meta] of Object.entries(jobs)) {
      chain.jobs[Number(index)] = { ...chain.jobs[Number(index)], ...meta };
    }
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: job metadata updated for ${Object.keys(jobs).length} job(s)`);
    return true;
  }

  /**
   * Queues additional work onto an active chain (ui9 B4 append): the manifest
   * grows immediately so the navigator updates live, ahead of the runner
   * picking the queued files up at the current phase's commit gate.
   */
  appendToChain(slug: string, entries: ChainManifestEntry[]): boolean {
    const chain = this.chains.get(slug);
    if (!chain || chain.status !== 'running') {
      return false;
    }
    chain.manifest = [...(chain.manifest ?? []), ...entries];
    // The phase total counts every unit the runner will execute, so wake and
    // event messages read "job 11 of 14" the moment an append is announced,
    // never the stale dispatch-time total (ui11 phase 14).
    if (chain.phases != null) {
      chain.phases += entries.length;
    }
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: ${entries.length} unit(s) appended`, { manifestLength: chain.manifest.length });
    return true;
  }

  /**
   * Amends a not-yet-started unit's manifest entry in place (ui14 job 8):
   * the planner folds a small same-files addition into a queued job as an
   * extra task, and the jobs view must show the new row and denominator
   * before the job starts. Only a unit strictly after the current one on a
   * running chain qualifies — the executing or finished unit's counters stay
   * honest. Adds no unit, so `phases` is untouched.
   */
  amendChainPhase(
    slug: string,
    phaseIndex: number,
    patch: { tasks?: string[]; name?: string; anchor?: string },
  ): 'ok' | 'unknown' | 'not-queued' {
    const chain = this.chains.get(slug);
    if (!chain || !chain.manifest) {
      return 'unknown';
    }
    const entry = chain.manifest[phaseIndex - 1];
    if (!entry || chain.status !== 'running' || phaseIndex <= (chain.currentPhase ?? 0)) {
      return 'not-queued';
    }
    if (patch.tasks) {
      entry.tasks = patch.tasks;
    }
    if (patch.name) {
      entry.name = patch.name;
    }
    if (patch.anchor) {
      entry.anchor = patch.anchor;
    }
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: unit ${phaseIndex} amended`, { tasks: entry.tasks.length });
    return 'ok';
  }

  /**
   * Live task check-offs (ui14 job 8): a running chain's punch list file is
   * watched so a box ticked mid-job broadcasts fresh done counts within the
   * debounce, not only at the next event or 20s poll. The parent directory
   * is watched (editors and sed -i replace the file, which orphans a
   * file-level watch); a terminal chain drops its watcher.
   */
  private syncPunchlistWatcher(chain: ChainRecord): void {
    const active = this.punchlistWatchers.get(chain.slug);
    if (chain.status !== 'running' || !chain.punchlist) {
      if (active) {
        active.watcher.close();
        if (active.timer) {
          clearTimeout(active.timer);
        }
        this.punchlistWatchers.delete(chain.slug);
      }
      return;
    }
    if (active) {
      return;
    }
    const file = chain.punchlist;
    const mtimeOf = (): number => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        return 0;
      }
    };
    try {
      const watcher = fs.watch(path.dirname(file), { persistent: false }, (_eventType, filename) => {
        if (filename && filename.toString() !== path.basename(file)) {
          return;
        }
        const state = this.punchlistWatchers.get(chain.slug);
        if (!state) {
          return;
        }
        if (state.timer) {
          clearTimeout(state.timer);
        }
        state.timer = setTimeout(() => {
          state.timer = null;
          const mtimeMs = mtimeOf();
          if (mtimeMs === state.mtimeMs) {
            return;
          }
          state.mtimeMs = mtimeMs;
          const current = this.chains.get(chain.slug);
          if (current) {
            this.broadcastChainProgress(current);
          }
        }, PUNCHLIST_DEBOUNCE_MS);
      });
      watcher.on('error', (error) => {
        log(`chain ${chain.slug}: punch list watch error: ${error.message}`);
      });
      this.punchlistWatchers.set(chain.slug, { watcher, timer: null, mtimeMs: mtimeOf() });
    } catch (error) {
      log(`chain ${chain.slug}: cannot watch punch list ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Task boundaries from check-off detection (ui13 job 14): when a unit's
   * punch-list done count has advanced past its recorded task times, stamp
   * the newly checked tasks. Only the live unit (running, phaseActive,
   * currentPhase) gets a real timestamp — a count that moved while the unit
   * was not observably live records null, never an invented time. Units
   * whose phase-start the watchdog never saw have no taskTimes array and
   * are left alone entirely.
   */
  private observeTaskCheckoffs(chain: ChainRecord, doneCounts: (number | null)[] | null): void {
    if (!doneCounts) {
      return;
    }
    let changed = false;
    for (let i = 0; i < doneCounts.length; i++) {
      const count = doneCounts[i];
      const meta = chain.jobs[i + 1];
      if (count == null || !meta?.taskTimes) {
        continue;
      }
      const live = chain.status === 'running' && chain.phaseActive && chain.currentPhase === i + 1;
      while (meta.taskTimes.length < count) {
        meta.taskTimes.push(live ? Date.now() : null);
        changed = true;
      }
    }
    if (changed) {
      this.persistChain(chain);
    }
  }

  private chainSnapshot(chain: ChainRecord): ChainSnapshot {
    // Per-unit done counts come from the punch list file, re-read here on
    // every snapshot — so each chain event's broadcast and each worker-runs
    // fetch (the 20s poll catches mid-phase commits) carries fresh counts.
    const doneCounts = punchlistDoneCounts(chain.punchlist, chain.manifest);
    this.observeTaskCheckoffs(chain, doneCounts);
    return {
      slug: chain.slug,
      projectPath: chain.projectPath,
      status: chain.status,
      phases: chain.phases,
      currentPhase: chain.currentPhase,
      phaseActive: chain.phaseActive,
      manifest: chain.manifest
        ? chain.manifest.map((entry, i) => ({ ...entry, done: doneCounts?.[i] ?? null, ...(chain.jobs[i + 1] ?? {}) }))
        : null,
      startedAt: chain.startedAt,
      lastEventAt: chain.lastEventAt,
    };
  }

  /** Streams per-phase progress to every open client (the navigator's feed). */
  private broadcastChainProgress(chain: ChainRecord): void {
    const event = JSON.stringify({ kind: 'chain_progress', chain: this.chainSnapshot(chain) });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(event);
      }
    });
  }

  chainEvent(
    slug: string,
    event: 'phase-start' | 'phase-end' | 'limit' | 'completed' | 'stopped' | 'failed',
    detail?: { phase?: number; summaryTail?: string; commit?: { hash: string; subject: string } },
  ): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    chain.lastEventAt = Date.now();
    if (typeof detail?.phase === 'number') {
      chain.currentPhase = detail.phase;
      // Per-job boundaries (ui13 job 14): phase-start anchors the job's
      // duration and its task-timing observations; phase-end closes it and
      // records the job's commit from the runner. A limit-retry's fresh
      // phase-start re-anchors — the successful attempt is what's timed.
      const meta = chain.jobs[detail.phase] ?? (chain.jobs[detail.phase] = {});
      if (event === 'phase-start') {
        meta.startedAt = Date.now();
        meta.taskTimes = [];
      } else if (event === 'phase-end') {
        meta.endedAt = Date.now();
        if (detail.commit) {
          meta.commitHash = detail.commit.hash;
          meta.commitSubject = detail.commit.subject;
        }
      }
    }
    if (detail?.summaryTail) {
      chain.lastSummaryTail = detail.summaryTail.slice(-2000);
    }
    // Honest run state: a phase session is live only between phase-start and
    // phase-end/terminal — never inferred from a session row's age.
    chain.phaseActive = event === 'phase-start';
    log(`chain ${slug}: ${event}`, { phase: chain.currentPhase, status: chain.status });

    // Session-limit auto-recovery (ui10 phase 1): not a failure. The runner
    // is switching accounts or waiting out the reset, then retrying the
    // phase; the chain stays running and the wake says so explicitly.
    if (event === 'limit') {
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      const tail = chain.lastSummaryTail ? `\n\nRecovery detail:\n${chain.lastSummaryTail}` : '';
      this.queueWake(
        chain.projectPath,
        `Watchdog: dispatched chain "${slug}" hit the session limit${chain.phases ? ` (job ${chain.currentPhase ?? '?'} of ${chain.phases})` : ''} `
        + `and is auto-recovering (account switch or reset wait, then retry). This is not a failure; no action needed.${tail}`,
      );
      return true;
    }

    if (event === 'completed' || event === 'stopped' || event === 'failed') {
      chain.status = event === 'completed' ? 'completed' : event === 'stopped' ? 'stopped' : 'failed';
      chain.wakePending = true;
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      this.syncPunchlistWatcher(chain);
      this.queueWake(chain.projectPath, terminalWakePrompt(chain), { chainSlug: slug });
    } else {
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
    }
    return true;
  }

  // ----- dispatched single runs (external run surface) -----

  runStarted(
    sessionId: string,
    projectPath: string,
    chainSlug: string | null,
    provider = 'claude',
    model: string | null = null,
  ): void {
    const run: DispatchRunRecord = {
      sessionId,
      projectPath,
      chainSlug,
      provider,
      model,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      stuckWakeSent: false,
      ended: false,
    };
    this.dispatchRuns.set(sessionId, run);
    this.persistDispatchRun(run);
  }

  runActivity(sessionId: string): void {
    const run = this.dispatchRuns.get(sessionId);
    if (run) {
      run.lastEventAt = Date.now();
      this.persistDispatchRun(run);
    }
  }

  runEnded(sessionId: string, projectPath: string, chainSlug: string | null): void {
    const run = this.dispatchRuns.get(sessionId);
    if (run) {
      run.ended = true;
      run.lastEventAt = Date.now();
      this.persistDispatchRun(run);
    }
    // Chain phases end at the chain runner's commit gate; the chain-end event
    // is the planner's wake for those. Only free-standing dispatched runs wake
    // the planner per run.
    if (!chainSlug) {
      this.queueWake(
        projectPath,
        `Watchdog: a dispatched run (session ${sessionId}) ended. `
        + 'Verify it against git log and the punch list before declaring anything done.',
      );
    }
  }

  /**
   * Active and recent worker runs for a project, newest first — the worker
   * pane's run switcher. DB rows (origin direct/dispatch/external) carry title, slug,
   * and model; live in-memory dispatch records supply the running state and
   * cover runs the filesystem synchronizer has not indexed yet. Used by the
   * providers session routes.
   */
  /**
   * Manifest name of one chain unit, for labeling a run outside the worker
   * pane (the sidebar counter drawer, ui11 phase 12). Null when the chain or
   * unit is unknown.
   */
  getChainPhaseName(chainSlug: string, chainPhase: number): string | null {
    return this.chains.get(chainSlug)?.manifest?.[chainPhase - 1]?.name ?? null;
  }

  listWorkerRuns(projectPath: string): { runs: WorkerRun[]; chains: Record<string, ChainSnapshot> } {
    const normalizedPath = normalizeProjectPath(projectPath);
    const rows = sessionsDb.listWorkerSessions(normalizedPath, 10);

    const knownIds = new Set<string>();
    for (const row of rows) {
      knownIds.add(row.session_id);
      if (row.provider_session_id) {
        knownIds.add(row.provider_session_id);
      }
    }

    // A live dispatched run whose session row is not indexed yet still shows
    // up — this is the "concurrent dispatched runs are invisible" fix.
    const liveOnly: WorkerRun[] = [...this.dispatchRuns.values()]
      .filter((run) => !run.ended && run.projectPath === normalizedPath && !knownIds.has(run.sessionId))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => ({
        sessionId: run.sessionId,
        provider: run.provider,
        origin: 'dispatch',
        booted: false,
        chainSlug: run.chainSlug,
        chainPhase: null,
        title: null,
        state: 'running' as const,
        model: run.model,
        lastActivity: new Date(run.lastEventAt).toISOString(),
      }));

    // Only the newest run of a chain can carry the chain's stopped/failed
    // state; earlier phases of that chain completed normally.
    const chainStateClaimed = new Set<string>();
    const fromRows: WorkerRun[] = rows.map((row) => {
      const live = this.dispatchRuns.get(row.session_id)
        ?? (row.provider_session_id ? this.dispatchRuns.get(row.provider_session_id) : undefined);
      const chainSlug = row.chain_slug ?? live?.chainSlug ?? null;
      // Run-state truth (ui9 B4): a chain phase reads running from the live
      // chain registry — its session row goes quiet between transcript syncs,
      // so the row alone would misreport an active phase as finished.
      const chain = chainSlug ? this.chains.get(chainSlug) : undefined;
      const chainActive = Boolean(
        chain
        && chain.status === 'running'
        && chain.phaseActive
        && row.chain_phase != null
        && chain.currentPhase === row.chain_phase,
      );
      const running = (live ? !live.ended : false)
        || chatRunRegistry.isProcessing(row.session_id)
        || chainActive;

      let state: WorkerRun['state'] = running ? 'running' : 'finished';
      if (!running && chainSlug && !chainStateClaimed.has(chainSlug)) {
        if (chain && (chain.status === 'stopped' || chain.status === 'failed')) {
          state = 'stopped';
        }
      }
      if (chainSlug) {
        chainStateClaimed.add(chainSlug);
      }

      const title = row.custom_name?.trim() && row.custom_name !== 'Untitled Claude Session'
        ? row.custom_name
        : null;

      return {
        sessionId: row.session_id,
        provider: row.provider,
        origin: row.origin,
        booted: Boolean(row.booted),
        chainSlug,
        chainPhase: row.chain_phase,
        title,
        state,
        model: row.model ?? live?.model ?? null,
        lastActivity: row.updated_at ?? row.created_at ?? null,
      };
    });

    // Snapshots for every chain this project's runs reference, plus chains
    // registered for the project whose first phase session has not landed yet
    // — the navigator shows the manifest the moment a dispatch registers.
    const chains: Record<string, ChainSnapshot> = {};
    for (const chain of this.chains.values()) {
      if (chain.projectPath === normalizedPath) {
        chains[chain.slug] = this.chainSnapshot(chain);
      }
    }
    for (const run of [...liveOnly, ...fromRows]) {
      const chain = run.chainSlug ? this.chains.get(run.chainSlug) : undefined;
      if (chain && !chains[chain.slug]) {
        chains[chain.slug] = this.chainSnapshot(chain);
      }
    }

    return { runs: [...liveOnly, ...fromRows], chains };
  }

  /**
   * Live dispatched runs for the running-sessions poll (ui13 job 13): these
   * are external processes absent from chatRunRegistry, so without this the
   * worker pane shows no activity indicator during a dispatched run. Runs
   * silent past the stuck threshold are excluded — a dead runner that never
   * reported its end must not read as processing forever.
   */
  listActiveDispatchRuns(): Array<{ sessionId: string; provider: string; startedAt: number }> {
    const now = Date.now();
    return [...this.dispatchRuns.values()]
      .filter((run) => !run.ended && now - run.lastEventAt < STUCK_SILENCE_MS)
      .map((run) => ({ sessionId: run.sessionId, provider: run.provider, startedAt: run.startedAt }));
  }

  permissionEvent(sessionId: string, kind: 'permission_request' | 'interactive_prompt', detail?: string): void {
    const run = this.dispatchRuns.get(sessionId);
    this.notify(
      'decision-needed',
      'Dispatched run needs a decision',
      `${kind === 'permission_request' ? 'A tool needs approval' : 'An interactive prompt is waiting'}`
      + `${detail ? `: ${detail}` : ''} (session ${sessionId}${run ? `, ${run.projectPath}` : ''}).`,
      { sessionId },
    );
  }

  // ----- notifications (spec B8: exactly two kinds, broadcast everywhere) -----

  notify(
    kind: 'decision-needed' | 'verified-done',
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): void {
    log(`notify ${kind}: ${title}`);
    void sendFleetNotification({ kind, title, body, data });

    // Foreground enhancement: visible tabs play the Orca notification sound.
    const event = JSON.stringify({
      kind: 'fleet_notification',
      notificationKind: kind,
      title,
      body,
      timestamp: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(event);
      }
    });
  }

  // ----- planner wakes (queued, serialized, retried while mid-turn) -----

  queueWake(projectPath: string, prompt: string, options: { freshBoot?: boolean; chainSlug?: string } = {}): void {
    const queue = this.wakeQueues.get(projectPath) ?? { prompts: [], draining: false };
    queue.prompts.push({ prompt, freshBoot: options.freshBoot, chainSlug: options.chainSlug, failures: 0 });
    this.wakeQueues.set(projectPath, queue);
    log(`wake queued for ${projectPath} (${queue.prompts.length} pending)`);
    void this.drainWakes(projectPath);
  }

  /** The wake reached the planner (or its fallback); the chain no longer owes one. */
  private wakeSettled(item: WakeItem): void {
    const chain = item.chainSlug ? this.chains.get(item.chainSlug) : undefined;
    if (chain?.wakePending) {
      chain.wakePending = false;
      this.persistChain(chain);
    }
  }

  /**
   * Wake-delivery fallback (ui14 job 7): a wake that cannot reach a planner is
   * never discarded silently — it goes out as a decision-needed fleet
   * notification carrying the wake text, then leaves the queue.
   */
  private wakeUndeliverable(projectPath: string, items: WakeItem[], reason: string): void {
    const body = items.map((item) => item.prompt.replace(/\s+/g, ' ').slice(0, 300)).join('\n\n');
    this.notify(
      'decision-needed',
      `Planner wake undeliverable for ${path.basename(projectPath)}`,
      `${reason}. The wake could not be delivered to a planner:\n\n${body}`,
      { projectPath },
    );
    for (const item of items) {
      this.wakeSettled(item);
    }
  }

  private async drainWakes(projectPath: string): Promise<void> {
    const queue = this.wakeQueues.get(projectPath);
    if (!queue || queue.draining) {
      return;
    }
    queue.draining = true;

    try {
      while (queue.prompts.length > 0) {
        const planner = sessionsDb.getLatestPlannerSession(projectPath);
        if (!planner) {
          log(`no planner session found for ${projectPath}; escalating ${queue.prompts.length} wake(s) to decision-needed`);
          this.wakeUndeliverable(projectPath, queue.prompts.splice(0), 'No planner session exists for this project');
          break;
        }

        // RUN_IN_PROGRESS: hold the wake and retry until the planner is idle.
        const running = chatRunRegistry
          .listRunningRuns()
          .some((run: { sessionId: string }) => run.sessionId === planner.session_id);
        if (running || this.isRuntimeBusy(planner.session_id)) {
          log(`planner ${planner.session_id} is mid-turn; retrying wake in ${WAKE_RETRY_MS / 1000}s`);
          setTimeout(() => {
            queue.draining = false;
            void this.drainWakes(projectPath);
          }, WAKE_RETRY_MS).unref?.();
          return;
        }

        const item = queue.prompts[0];
        log(`waking planner ${planner.session_id} for ${projectPath}${item.freshBoot ? ' (fresh boot)' : ''}`);

        // Fresh boots run as a registered app session (ui11 phase 3): the row
        // exists before the run (origin planner, booted), the stream goes out
        // through the run registry so every client can follow it live, and a
        // planner_handoff frame tells clients viewing the old session to
        // switch. A failed boot persists as boot_state 'failed' (Willem
        // retries from the UI) instead of retrying into more session rows.
        if (item.freshBoot) {
          await this.bootFreshPlanner(projectPath, planner.session_id, planner.model, item.prompt);
          queue.prompts.shift();
          this.wakeSettled(item);
          continue;
        }

        try {
          // Resume by provider-native id, but only when a transcript actually
          // exists on disk; otherwise boot a fresh planner session — the
          // planner is stateless by design and re-grounds from STATE.md.
          const resumeId = planner.jsonl_path ? planner.provider_session_id : null;
          const result = await this.runPlannerTurn(resumeId, planner.model, projectPath, item.prompt);
          if (result.errored && resumeId && /no conversation found/i.test(result.errorMessage ?? '')) {
            log(`planner session ${planner.session_id} is dead; booting a fresh planner`);
            const fresh = await this.runPlannerTurn(null, planner.model, projectPath, item.prompt);
            if (fresh.errored) {
              throw new Error(fresh.errorMessage ?? 'fresh planner boot failed');
            }
            this.tagFreshPlanner(fresh.announcedSessionId);
          } else if (result.errored) {
            throw new Error(result.errorMessage ?? 'wake run failed');
          }
          queue.prompts.shift();
          this.wakeSettled(item);
          log(`wake delivered to planner for ${projectPath} (${queue.prompts.length} left)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          item.failures += 1;
          if (item.failures >= WAKE_MAX_FAILURES) {
            log(`wake failed ${item.failures}x for ${projectPath}: ${message}; escalating to decision-needed`);
            queue.prompts.shift();
            this.wakeUndeliverable(projectPath, [item], `Delivery failed ${item.failures} times (last error: ${message})`);
            continue;
          }
          log(`wake failed for ${projectPath}: ${message}; retrying in ${WAKE_RETRY_MS / 1000}s`);
          setTimeout(() => {
            queue.draining = false;
            void this.drainWakes(projectPath);
          }, WAKE_RETRY_MS).unref?.();
          return;
        }
      }
    } finally {
      queue.draining = false;
    }
  }

  private isRuntimeBusy(sessionId: string): boolean {
    try {
      const pending = providerRuntimeService.getPendingApprovalsForSession(sessionId);
      return Array.isArray(pending) && pending.length > 0;
    } catch {
      return false;
    }
  }

  private async runPlannerTurn(
    providerSessionId: string | null,
    model: string | null,
    projectPath: string,
    prompt: string,
    onAnnounced?: (announcedSessionId: string) => void,
  ): Promise<{ errored: boolean; errorMessage: string | null; announcedSessionId: string | null }> {
    const runner = providerRuntimeService.getRunner('claude');
    let announcedId: string | null = providerSessionId;
    let errorMessage: string | null = null;
    const writer = {
      // The provider runtime reports SDK failures as error events instead of
      // throwing; capture them so the queue can retry or fall back.
      send: (data: unknown) => {
        const event = data as { type?: string; kind?: string; error?: unknown; message?: unknown; content?: unknown } | null;
        if (event && (event.type === 'error' || event.kind === 'error')) {
          errorMessage = String(event.error ?? event.message ?? event.content ?? 'unknown error');
        }
      },
      setSessionId: (id: string) => {
        announcedId = id;
        onAnnounced?.(id);
      },
      getSessionId: () => announcedId,
      end: () => undefined,
    };
    await runner(
      prompt,
      {
        projectPath,
        cwd: projectPath,
        sessionId: providerSessionId,
        model: model || undefined,
        permissionMode: 'bypassPermissions',
      },
      writer,
    );
    return { errored: errorMessage !== null, errorMessage, announcedSessionId: announcedId };
  }

  /**
   * A planner session's /handoff turn completed cleanly (Handoff button or
   * typed /handoff): boot the next planner for the project through the same
   * fresh-boot wake the rotation uses.
   */
  plannerHandoffComplete(projectPath: string): void {
    this.checkHandoffPushed(projectPath).catch((error) => {
      log(`handoff push check failed for ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.queueWake(projectPath, readPlannerBootPrompt(), { freshBoot: true });
  }

  /**
   * A handoff that ended cleanly but left planner/<project> uncommitted or
   * the memory repo unpushed (audit 2.8) fires decision-needed: the other
   * machines would otherwise boot from a stale STATE.md with no signal.
   */
  private async checkHandoffPushed(projectPath: string): Promise<void> {
    const normalized = normalizeProjectPath(projectPath);
    const project = projectsDb.getProjectPaths().find((row) => normalizeProjectPath(row.project_path) === normalized);
    const memoryFolder = project?.planner_memory_name?.trim() || path.basename(normalized);
    const repoRoot = path.dirname(PLANNER_MEMORY_ROOT);
    const problem = await findUnpushedHandoff(repoRoot, memoryFolder);
    if (!problem) {
      return;
    }
    this.notify(
      'decision-needed',
      'Handoff did not push',
      `The /handoff for ${normalized} ended but ${problem}. Push ${repoRoot} by hand so the other machines see this handoff.`,
      { projectPath: normalized },
    );
  }

  /**
   * Boots a brand-new planner session as a registered app run (ui11 phase 3):
   * the session row exists before the run (origin planner, booted, placeholder
   * title), the boot stream broadcasts through the chat run registry, and a
   * `planner_handoff` frame tells clients viewing the outgoing session to
   * switch to the new one and hold a loader until its opening message.
   * Never throws; a failed boot persists as boot_state 'failed'.
   */
  private async bootFreshPlanner(
    projectPath: string,
    fromSessionId: string,
    model: string | null,
    prompt: string,
  ): Promise<void> {
    let sessionId: string;
    try {
      sessionId = sessionsService.createAppSession('claude', projectPath, prompt, 'planner', true).sessionId;
      sessionsDb.markSessionBooted(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`fresh planner boot setup failed for ${projectPath}: ${message}`);
      return;
    }
    const run = chatRunRegistry.startRun({
      appSessionId: sessionId,
      provider: 'claude',
      providerSessionId: null,
      userId: null,
    });
    if (!run) {
      log(`fresh planner session ${sessionId} already has a run in progress`);
      return;
    }

    const handoffEvent = JSON.stringify({
      kind: 'planner_handoff',
      projectPath,
      fromSessionId,
      toSessionId: sessionId,
      timestamp: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(handoffEvent);
      }
    });

    let runtimeThrew = false;
    try {
      await providerRuntimeService.run(
        'claude',
        prompt,
        {
          sessionId,
          cwd: projectPath,
          projectPath,
          model: model || undefined,
          permissionMode: 'bypassPermissions',
          bootPrompt: true,
        },
        run.writer,
      );
    } catch (error) {
      runtimeThrew = true;
      const message = error instanceof Error ? error.message : String(error);
      log(`fresh planner boot failed for ${projectPath}: ${message}`);
    } finally {
      chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
      const failed = runtimeThrew || run.sawError || run.aborted;
      sessionsDb.setSessionBootState(sessionId, failed ? 'failed' : 'ready');
      log(`fresh planner ${sessionId} booted for ${projectPath}${failed ? ' (FAILED)' : ''}`);
    }
  }

  /** A watchdog-booted planner session joins the rotation sweep's target set. */
  private tagFreshPlanner(providerSessionId: string | null): void {
    if (!providerSessionId) {
      return;
    }
    try {
      sessionsDb.setSessionOrigin(providerSessionId, 'planner');
    } catch {
      // tagging is best-effort
    }
  }

  // ----- periodic sweep: stuck runs + machine resources -----

  private async sweep(): Promise<void> {
    const now = Date.now();

    await this.sweepChains(now);

    for (const run of this.dispatchRuns.values()) {
      if (run.ended || run.stuckWakeSent) {
        continue;
      }
      if (now - run.lastEventAt > STUCK_SILENCE_MS) {
        run.stuckWakeSent = true;
        this.persistDispatchRun(run);
        log(`dispatched run ${run.sessionId} silent for 30m; waking planner to assess`);
        this.queueWake(
          run.projectPath,
          `Watchdog: dispatched session ${run.sessionId} has emitted nothing for 30 minutes. `
          + 'Assess before acting: check process liveness and the run journal first; long builds emit '
          + 'nothing mid-tool-call, so never kill blind. Re-dispatch or escalate only after assessing.',
        );
      }
    }

    // Prune finished runs older than a day so the map stays small.
    for (const [sessionId, run] of this.dispatchRuns) {
      if (run.ended && now - run.lastEventAt > 24 * 60 * 60 * 1000) {
        this.dispatchRuns.delete(sessionId);
        try {
          watchdogDb.deleteDispatchRun(sessionId);
        } catch {
          // prune retries next sweep
        }
      }
    }

    await this.checkResources(now);
    await this.checkPlannerRotation();
  }

  /**
   * Chain liveness sweep (ui14 job 7, audit 2.1): a chain is never left
   * "running" forever. Every sweep checks each running chain's runner process
   * in the process table; a gone runner stops the chain at once. A runner
   * that is alive but whose live phase has produced no event, journal line,
   * phase log write, or transcript write for CHAIN_WEDGE_MS is wedged and is
   * stopped too — the runner is left for the woken planner to assess and
   * kill, never killed blind. Between phases (limit waits, slot waits) an
   * alive runner is trusted.
   */
  private async sweepChains(now: number): Promise<void> {
    const running = [...this.chains.values()].filter((chain) => chain.status === 'running');
    if (!running.length) {
      return;
    }
    const runners = await listChainRunners();
    if (!runners) {
      return;
    }
    for (const chain of running) {
      const pid = runners.get(chain.slug);
      if (pid === undefined) {
        this.stopChainFromSweep(
          chain,
          `Liveness sweep: the chain's runner process is gone with the chain still running `
          + `(last event ${formatAge(now - chain.lastEventAt)} ago, journal: ${journalLastLine(chain.slug) ?? 'none'}).`,
        );
        continue;
      }
      if (!chain.phaseActive || now - chain.lastEventAt < CHAIN_WEDGE_MS) {
        continue;
      }
      const activityAt = chainActivityAt(chain);
      if (now - activityAt < CHAIN_WEDGE_MS) {
        continue;
      }
      this.stopChainFromSweep(
        chain,
        `Liveness sweep: runner pid ${pid} is alive but job ${chain.currentPhase ?? '?'} has been silent for `
        + `${formatAge(now - Math.max(chain.lastEventAt, activityAt))} (no event, journal, phase log, or transcript write). `
        + `Assess the runner and its claude process before killing pid ${pid}; journal: ${journalLastLine(chain.slug) ?? 'none'}.`,
      );
    }
  }

  private stopChainFromSweep(chain: ChainRecord, reason: string): void {
    chain.status = 'stopped';
    chain.phaseActive = false;
    chain.lastEventAt = Date.now();
    chain.lastSummaryTail = reason;
    chain.wakePending = true;
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain ${chain.slug}: stopped by the liveness sweep`, { reason });
    this.queueWake(chain.projectPath, terminalWakePrompt(chain), { chainSlug: chain.slug });
  }

  // ----- planner auto-rotation (spec B7): /handoff at the context threshold -----

  private async checkPlannerRotation(): Promise<void> {
    if (appConfigDb.get('planner_rotation_enabled') === '0') {
      return;
    }
    const threshold = Number(appConfigDb.get('planner_rotation_threshold') ?? 60);

    for (const planner of sessionsDb.listPlannerSessions()) {
      if (this.rotatedSessions.has(planner.session_id) || !planner.project_path) {
        continue;
      }
      try {
        const usage = (await providerTokenUsageService.getSessionTokenUsage(planner.session_id)) as {
          used?: number;
          total?: number;
        };
        const used = Number(usage?.used ?? 0);
        const total = Number(usage?.total ?? 0);
        if (!used || !total) {
          continue;
        }
        const pct = (used / total) * 100;
        if (pct < threshold) {
          continue;
        }
        this.rotatedSessions.add(planner.session_id);
        log(`planner ${planner.session_id} at ${pct.toFixed(1)}% of its window (threshold ${threshold}%); rotating`);
        this.queueWake(
          planner.project_path,
          `Watchdog: this planner session's context usage is ${pct.toFixed(0)}% of the model's real window `
          + `(threshold ${threshold}%). Run /handoff now per doctrine: file the handoff, refresh STATE.md, `
          + 'commit and push planner memory. A fresh planner will boot from STATE.md right after.',
        );
        this.queueWake(planner.project_path, readPlannerBootPrompt(), { freshBoot: true });
      } catch {
        // usage may be unavailable for sessions without transcripts; skip
      }
    }
  }

  private async checkResources(now: number): Promise<void> {
    try {
      const stats = await fsp.statfs('/');
      const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
      if (freeGb < MIN_FREE_DISK_GB && this.shouldAlert('disk', now)) {
        this.notify(
          'decision-needed',
          'Mini disk space low',
          `Free disk space is ${freeGb.toFixed(1)} GB (threshold ${MIN_FREE_DISK_GB} GB).`,
        );
      }
    } catch {
      // statfs unavailable; skip silently
    }

    try {
      const freePct = await readMemoryFreePercentage();
      if (freePct !== null && freePct < MIN_FREE_MEM_PCT && this.shouldAlert('memory', now)) {
        this.notify(
          'decision-needed',
          'Mini memory pressure high',
          `System-wide free memory is ${freePct}% (threshold ${MIN_FREE_MEM_PCT}%).`,
        );
      }
    } catch {
      // memory_pressure unavailable; skip silently
    }
  }

  private shouldAlert(key: string, now: number): boolean {
    const last = this.resourceAlertAt.get(key) ?? 0;
    if (now - last < RESOURCE_ALERT_THROTTLE_MS) {
      return false;
    }
    this.resourceAlertAt.set(key, now);
    return true;
  }

  // ----- Monday self-maintenance (spec B9) -----

  /**
   * Dispatches the weekly maintenance run into the CloudCLI project: upstream
   * delta classification with backend-safe auto-apply through the dispatch →
   * dev-verify → promote loop, plus the Claude Code CLI version assessment.
   * Silent when safe, decision-needed when judgment-shaped, silence when
   * there is nothing. classifyOnly runs the same checks but applies nothing —
   * the manual-trigger test mode.
   */
  async runMaintenance(classifyOnly = false): Promise<{ started: boolean }> {
    const repo = process.env.CLOUDCLI_REPO || path.join(os.homedir(), 'Projects', 'cloudcli');
    log(`maintenance run starting${classifyOnly ? ' (classify-only)' : ''}`);

    const prompt = buildMaintenancePrompt(repo, classifyOnly);
    // Maintenance runs are their own system kind: labeled in the run switcher,
    // never in chat lists. Tagged at announce time so the label shows while
    // the run is live; the upsert context covers a run ending before the
    // filesystem watcher indexes its transcript.
    const tagMaintenanceSession = (announcedSessionId: string): void => {
      try {
        sessionsDb.setSessionOrigin(
          announcedSessionId,
          'maintenance',
          null,
          null,
          null,
          { provider: 'claude', projectPath: repo },
        );
      } catch {
        // tagging is best-effort
      }
    };
    void (async () => {
      try {
        const result = await this.runPlannerTurn(null, null, repo, prompt, tagMaintenanceSession);
        if (result.announcedSessionId) {
          tagMaintenanceSession(result.announcedSessionId);
        }
        if (result.errored) {
          log(`maintenance run errored: ${result.errorMessage}`);
          this.notify(
            'decision-needed',
            'Monday maintenance run failed',
            `The self-maintenance run errored: ${result.errorMessage ?? 'unknown error'}.`,
          );
        } else {
          log('maintenance run finished');
        }
      } catch (error) {
        log(`maintenance run threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return { started: true };
  }

  private scheduleWeeklyMaintenance(): void {
    const next = new Date();
    // Monday 09:05 local, five minutes after the push self-test.
    next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
    next.setHours(9, 5, 0, 0);
    const delay = Math.max(next.getTime() - Date.now(), 60 * 1000);
    setTimeout(() => {
      void this.runMaintenance(false);
      this.scheduleWeeklyMaintenance();
    }, delay).unref?.();
    log(`weekly maintenance scheduled for ${next.toISOString()}`);
  }

  // ----- weekly self-test (silent push death gets caught) -----

  private scheduleWeeklySelfTest(): void {
    const next = new Date();
    // Next Monday 09:00 local time.
    next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
    next.setHours(9, 0, 0, 0);
    const delay = Math.max(next.getTime() - Date.now(), 60 * 1000);
    this.selfTestTimer = setTimeout(() => {
      this.notify(
        'verified-done',
        'Weekly push self-test',
        'If you can read this on your device, push delivery is alive.',
      );
      this.scheduleWeeklySelfTest();
    }, delay);
    this.selfTestTimer.unref?.();
    log(`weekly self-test scheduled for ${next.toISOString()}`);
  }

  status() {
    return {
      chains: [...this.chains.values()],
      dispatchRuns: [...this.dispatchRuns.values()],
      wakeQueues: Object.fromEntries(
        [...this.wakeQueues.entries()].map(([projectPath, queue]) => [
          projectPath,
          { pending: queue.prompts.length, draining: queue.draining },
        ]),
      ),
    };
  }
}

/**
 * The Monday self-maintenance prompt (spec B9): two targets, journal always,
 * notifications only for judgment-shaped findings, silence when current.
 */
function buildMaintenancePrompt(repo: string, classifyOnly: boolean): string {
  const mode = classifyOnly
    ? '\nTHIS RUN IS CLASSIFY-ONLY: perform every check and journal every classification, but apply '
      + 'nothing, promote nothing, update nothing, and send no notifications. For anything you would '
      + 'have applied or escalated, journal what the full run would have done.\n'
    : '';
  return `You are the Monday self-maintenance run for the CloudCLI fork on the Mac mini. Work in ${repo}.
Append one line per finding to ~/forge-logs/monday-maintenance/JOURNAL.md as: HH:MM | item | classification | detail. Create the folder if missing.
${mode}
1. Upstream CloudCLI: ensure a git remote "upstream" exists pointing at https://github.com/siteboon/claudecodeui (add it if missing), git fetch upstream, and compare the upstream default branch against HEAD. Classify each new upstream commit as backend-safe (server-only, no frontend or build-surface changes), frontend-touching, or skip (release chores). Backend-safe commits: apply them, run npm run build and npm test, verify the dev instance boots healthy (launchctl kickstart -k gui/$(id -u)/com.spoton.cloudcli-dev then curl http://127.0.0.1:4748/health), then promote with the "promote" CLI; every applied change gets a descriptive commit. Frontend-touching commits: never apply; send ONE decision-needed notification summarizing them via POST http://127.0.0.1:4747/api/watchdog/notify with header x-api-key read at runtime from ~/.cloudcli/auth.db (sqlite3: SELECT api_key FROM api_keys WHERE is_active=1 LIMIT 1). Never print that key.
2. Claude Code CLI: compare the installed "claude --version" against the latest available version. If behind, read the release notes for the gap and assess impact on this fork (SDK behavior, flags the launchers pin, classifier or model changes) and on the planner/worker doctrine (~/Projects/spoton-worker/PLANNER.md, planner/reference/ including dispatch.md, and ~/.claude/commands/worker.md). Safe updates and doctrine touch-ups: apply silently with commits. Judgment-shaped changes (a breaking change, a new feature worth adopting, a doctrine rewrite): one decision-needed notification instead of silent edits.
3. A category with nothing to do gets a "nothing to do" journal line and NO notification. Total silence toward Willem is the correct outcome when everything is current.
Never push the scratch repo. Keep the final summary to a few lines.`;
}

/**
 * The /planner boot ritual as a plain prompt: a fresh rotated planner boots
 * through the same steps the slash command runs, grounding from STATE.md.
 */
function readPlannerBootPrompt(): string {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude', 'commands', 'planner.md'), 'utf8');
    const body = raw.replace(/^---[\s\S]*?---\n/, '').trim();
    if (body) {
      return body;
    }
  } catch {
    // fall through to the minimal boot instruction
  }
  return 'Boot as this project\'s planner: read PLANNER.md, the project\'s PROJECT.md and STATE.md '
    + 'in the planner memory repo, and open with the session-start summary.';
}

/**
 * Normalizes an untrusted manifest value (DB JSON or request body) into clean
 * entries, dropping anything malformed. Returns null when nothing survives.
 */
export function parseManifest(value: unknown): ChainManifestEntry[] | null {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const entries: ChainManifestEntry[] = [];
  for (const item of raw) {
    const entry = item as { name?: unknown; tasks?: unknown; kind?: unknown; anchor?: unknown } | null;
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      continue;
    }
    const tasks = Array.isArray(entry?.tasks)
      ? entry.tasks.filter((task): task is string => typeof task === 'string' && task.trim() !== '')
      : [];
    const anchor = typeof entry?.anchor === 'string' && entry.anchor.trim() ? entry.anchor.trim() : undefined;
    entries.push({ name, tasks, kind: entry?.kind === 'task' ? 'task' : 'phase', ...(anchor ? { anchor } : {}) });
  }
  return entries.length ? entries : null;
}

/**
 * Normalizes an untrusted job-meta value (DB JSON or request body) into a
 * clean 1-based index → metadata map, dropping anything malformed.
 */
export function parseJobMeta(value: unknown): Record<number, ChainJobMeta> {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const jobs: Record<number, ChainJobMeta> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 1 || !item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const meta: ChainJobMeta = {};
    if (Number.isFinite(Number(entry.startedAt))) {
      meta.startedAt = Number(entry.startedAt);
    }
    if (Number.isFinite(Number(entry.endedAt))) {
      meta.endedAt = Number(entry.endedAt);
    }
    if (typeof entry.commitHash === 'string' && entry.commitHash.trim()) {
      meta.commitHash = entry.commitHash.trim();
    }
    if (typeof entry.commitSubject === 'string' && entry.commitSubject.trim()) {
      meta.commitSubject = entry.commitSubject.trim();
    }
    if (Array.isArray(entry.taskTimes)) {
      meta.taskTimes = entry.taskTimes.map((t) => (Number.isFinite(Number(t)) && t !== null ? Number(t) : null));
    }
    if (Object.keys(meta).length) {
      jobs[index] = meta;
    }
  }
  return jobs;
}

/**
 * Per-unit done counts from the run's punch list file (ui11 phase 6): for each
 * manifest entry with a heading anchor, count the checked boxes (`- [x]`) in
 * the punch list section whose markdown heading contains the anchor. Returns
 * null (whole array or per entry) when the file, entry anchor, or section is
 * missing — the navigator shows no counter rather than a made-up one.
 */
function punchlistDoneCounts(
  punchlist: string | null,
  manifest: ChainManifestEntry[] | null,
): (number | null)[] | null {
  if (!punchlist || !manifest) {
    return null;
  }
  let lines: string[];
  try {
    lines = fs.readFileSync(punchlist, 'utf8').split('\n');
  } catch {
    return null;
  }
  return manifest.map((entry) => {
    if (!entry.anchor) {
      return null;
    }
    const anchor = entry.anchor.toLowerCase();
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (heading && heading[2].toLowerCase().includes(anchor)) {
        start = i + 1;
        level = heading[1].length;
        break;
      }
    }
    if (start < 0) {
      return null;
    }
    let done = 0;
    for (let i = start; i < lines.length; i++) {
      const heading = /^(#{1,6})\s/.exec(lines[i]);
      if (heading && heading[1].length <= level) {
        break;
      }
      if (/^\s*[-*]\s+\[[xX]\]\s/.test(lines[i])) {
        done += 1;
      }
    }
    return done;
  });
}

/**
 * The planner wake for a chain that reached a terminal state. Rebuilt from
 * the record (never stored) so hydrate can re-derive it after a restart.
 */
function terminalWakePrompt(chain: ChainRecord): string {
  const flag = chain.status === 'completed'
    ? 'ended'
    : chain.status === 'stopped'
      ? 'STOPPED'
      : 'FAILED';
  const tail = chain.lastSummaryTail ? `\n\nFinal summary tail:\n${chain.lastSummaryTail}` : '';
  return `Watchdog: dispatched chain "${chain.slug}" ${flag}${chain.phases ? ` (job ${chain.currentPhase ?? '?'} of ${chain.phases})` : ''}. `
    + `Verify the result against git log and the punch list before declaring anything done.${tail}`;
}

/**
 * Chain runners found in the process table, keyed by slug. The runner's argv
 * is `dispatch-chain-runner <repo> <slug> <phase files...>`, so the slug
 * sits between two spaces after the script name. Null when ps itself failed
 * (the sweep then trusts every chain rather than stopping on no evidence).
 */
function listChainRunners(): Promise<Map<string, number> | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-axww', '-o', 'pid=,command='], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const runners = new Map<string, number>();
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (!match || !match[2].includes('dispatch-chain-runner ')) {
          continue;
        }
        const args = match[2].split(/\s+/);
        const runnerIndex = args.findIndex((arg) => arg.endsWith('dispatch-chain-runner'));
        const slug = args[runnerIndex + 2];
        if (slug) {
          runners.set(slug, Number(match[1]));
        }
      }
      resolve(runners);
    });
  });
}

function chainJournalDir(slug: string): string {
  return path.join(os.homedir(), 'forge-logs', slug);
}

function journalLastLine(slug: string): string | null {
  try {
    const lines = fs.readFileSync(path.join(chainJournalDir(slug), 'JOURNAL.md'), 'utf8').trimEnd().split('\n');
    return lines[lines.length - 1] || null;
  } catch {
    return null;
  }
}

/**
 * Newest write the live phase has left behind: the run journal, the phase's
 * stdout log, and the phase session's transcript (plus its subagent
 * transcripts beside it). 0 when nothing of the kind exists.
 */
function chainActivityAt(chain: ChainRecord): number {
  const candidates = [path.join(chainJournalDir(chain.slug), 'JOURNAL.md')];
  if (chain.currentPhase != null) {
    candidates.push(path.join(chainJournalDir(chain.slug), `phase${chain.currentPhase}.log`));
    try {
      const session = sessionsDb
        .listWorkerSessions(chain.projectPath, 10)
        .find((row) => row.chain_slug === chain.slug && row.chain_phase === chain.currentPhase);
      if (session?.jsonl_path) {
        candidates.push(session.jsonl_path);
        candidates.push(path.join(path.dirname(session.jsonl_path), path.basename(session.jsonl_path, '.jsonl')));
      }
    } catch {
      // no session row yet; the file signals still count
    }
  }
  return Math.max(0, ...candidates.map(newestMtime));
}

function newestMtime(target: string): number {
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return stat.mtimeMs;
    }
    return Math.max(stat.mtimeMs, ...fs.readdirSync(target).map((entry) => newestMtime(path.join(target, entry))));
  } catch {
    return 0;
  }
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 90 ? `${minutes}m` : `${(minutes / 60).toFixed(1)}h`;
}

function readMemoryFreePercentage(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('memory_pressure', ['-Q'], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const match = /free percentage:\s*(\d+)/i.exec(stdout);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

export const watchdogService = new WatchdogService();
