import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { projectsDb, sessionsDb, watchdogDb } from '@/modules/database/index.js';
import { accountUsageMonitor } from '@/modules/accounts/index.js';
import { PLANNER_MEMORY_ROOT } from '@/modules/memory/index.js';
import { providerRuntimeService, providerTokenUsageService, sessionsService } from '@/modules/providers/index.js';
import { sendFleetNotification } from '@/modules/notifications/index.js';
import { settingsService, type WatchdogBehavior } from '@/modules/settings/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { normalizeProjectPath, wrapMachineMessage } from '@/shared/utils.js';
import { WS_OPEN_STATE, chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

import {
  getLegacyDataDirectory,
  getLegacyProjectDirectory,
  LEGACY_RUNTIME_ANCHORS,
  readRenamedEnvironmentVariable,
} from '../../../shared/runtime-anchors.js';

import { findUnpushedHandoff } from './handoff-push.js';
import { UnitIdentityCache, hiddenTwinUnits, summarizeHidden, type TwinChain } from './chain-twins.js';

type ChainStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

const MANIFEST_NAME_MAX = 120;
const MANIFEST_TASK_MAX = 160;
const MANIFEST_ANCHOR_MAX = 120;

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
 * Watchdog persistence stores it in job_meta and jobs snapshots expose it to
 * the worker-pane history.
 */
export type ChainJobMeta = {
  startedAt?: number;
  endedAt?: number;
  commitHash?: string;
  commitSubject?: string;
  taskTimes?: (number | null)[];
  /** Checked items already present when this attempt began; never progress. */
  taskDoneBaseline?: number;
  /** One-line source detail captured when this job fails or stops. */
  failureReason?: string;
  /**
   * Verify stage (ui14 job 10): the runner's fresh-context verifier runs
   * against the job's commit while the next job builds. Absent on units the
   * runner never verified (older chains, `verify: no` prompts).
   */
  verify?: 'running' | 'passed' | 'failed' | 'inconclusive' | 'stopped';
  /** Exact runner-supplied reason for a failed or inconclusive verdict. */
  verifyReason?: string;
  verifyStartedAt?: number;
  verifyEndedAt?: number;
  /** The verifier's session id, pre-announced by the runner. */
  verifySessionId?: string;
  /** The build stage's engine and model, from the runner's announce (codex job 2). */
  engine?: string;
  model?: string;
  /** Whether this build unit launched on Codex's fast service tier. */
  fastMode?: boolean;
  /** Post-commit server-suite result; red does not stop the chain. */
  suite?: 'green' | 'red';
  /** Failing test names extracted from the runner's durable suite log. */
  suiteFailures?: string[];
};

/**
 * A chain reaching a terminal state (event, or the liveness sweep) settles
 * any verify still in flight as stopped: the verifier is dead or orphaned
 * with the runner, and a live counter must not tick on forever.
 */
function settleRunningVerifies(chain: ChainRecord): void {
  for (const meta of Object.values(chain.jobs)) {
    if (meta.verify === 'running') {
      meta.verify = 'stopped';
      meta.verifyEndedAt = Date.now();
    }
  }
}

type ChainRecord = {
  slug: string;
  projectPath: string;
  /** Planner chat that dispatched the chain, or the live fallback adopted after its lineage died. */
  dispatchingSessionId: string | null;
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
  /** Read afresh by the runner before each build unit; false by default. */
  fastMode: boolean;
  /** True while the runner owes a clean boundary stop requested by promote. */
  holdRequested: boolean;
  /** The boundary hold owner shown by the jobs history while held. */
  holdReason: string | null;
};

type VerifySummary = {
  passed: number;
  failed: number;
  inconclusive: number;
};

/** First-class verifier totals for the jobs payload and terminal summary. */
function countVerifyVerdicts(chain: ChainRecord): VerifySummary {
  const summary: VerifySummary = { passed: 0, failed: 0, inconclusive: 0 };
  for (const meta of Object.values(chain.jobs)) {
    if (meta.verify === 'passed' || meta.verify === 'failed' || meta.verify === 'inconclusive') {
      summary[meta.verify] += 1;
    }
  }
  return summary;
}

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
  /** Set on a unit's verifier session (ui14 job 10); absent on build sessions. */
  chainStage?: 'verify';
  title: string | null;
  state: 'running' | 'finished' | 'stopped';
  model: string | null;
  /** Original run start, distinct from last transcript activity. */
  startedAt: number | string | null;
  lastActivity: string | null;
  /** Whole-session spend (fresh input plus output) from the provider's transcript or rollout. */
  tokenCount: number | null;
  /** Context re-read from cache across the session, never part of the spend. */
  cacheReadCount: number | null;
};

type ChainEventName =
  | 'phase-start'
  | 'phase-end'
  | 'suite-end'
  | 'verify-start'
  | 'verify-end'
  | 'verify-failed'
  | 'limit'
  | 'paused'
  | 'held'
  | 'completed'
  | 'stopped'
  | 'failed';

/** The watchdog routes use this allowlist to reject unknown runner events. */
export const CHAIN_EVENT_NAMES: ChainEventName[] = [
  'phase-start',
  'phase-end',
  'suite-end',
  'verify-start',
  'verify-end',
  'verify-failed',
  'limit',
  'paused',
  'held',
  'completed',
  'stopped',
  'failed',
];

/** Chain snapshot the worker pane's phase navigator renders from. */
type ChainSnapshot = {
  slug: string;
  projectPath: string;
  status: ChainStatus;
  phases: number | null;
  currentPhase: number | null;
  phaseActive: boolean;
  /** Current chain preference; changing it affects the next build unit only. */
  fastMode: boolean;
  /** True until a requested clean boundary hold is released or resumed. */
  holdRequested: boolean;
  /** `promote` while the paused treatment represents a promotion boundary. */
  holdReason: string | null;
  /** Failed verifier verdicts recorded so far; they never change chain status. */
  verifyFailures: number;
  /** Terminal-safe totals keep inconclusive distinct from both pass and fail. */
  verifySummary: VerifySummary;
  /** Manifest entries with the punch-list `done` count and the unit's commit
   *  and timing metadata (ui13 job 14) folded in per unit; a twin superseded
   *  by another chain's unit (codex job 5) is marked hidden with its winner. */
  manifest: (ChainManifestEntry & { done: number | null; hidden?: true; supersededBy?: string } & ChainJobMeta)[] | null;
  /** Prompt files still queued after a terminal runner event. */
  orphanedAppends: number;
  startedAt: number;
  lastEventAt: number;
};

type PunchlistSection = {
  /** Absolute path to the markdown punch list that owns this unit. */
  file: string;
  /** Planner-supplied heading substring, when the manifest carries one. */
  anchor?: string;
  /** Prompt-derived Job/Phase number, used when the manifest has no anchor. */
  unitNumber?: number;
};

type WakeItem = {
  prompt: string;
  /** Always boots a brand-new planner session instead of resuming. */
  freshBoot?: boolean;
  /** Chain whose wakePending flag this wake clears once delivered. */
  chainSlug?: string;
  /** Explicit planner lineage anchor for handoff/rotation wakes. */
  targetSessionId?: string;
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
// Consumed by the dispatch pause route: one unattended verifier gets its full
// 30-minute turn budget before the control request reports a timeout.
const CHAIN_PAUSE_TIMEOUT_MS = Number(process.env.WATCHDOG_CHAIN_PAUSE_TIMEOUT_MS || 30 * 60 * 1000);
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
  /** One directory watcher per running chain's active punch list (ui14 job 8). */
  private punchlistWatchers = new Map<string, {
    watcher: fs.FSWatcher;
    timer: ReturnType<typeof setTimeout> | null;
    mtimeMs: number;
    file: string;
  }>();
  /** Twin grouping (codex job 5): prompt-file identities and the last result per project. */
  private twinIdentities = new UnitIdentityCache();
  private twinResults = new Map<string, { signature: string; hidden: Map<string, Map<number, string>>; summary: string }>();

  /**
   * Every automatic behavior asks the System tab's stored policy at its
   * action point (the settings service answers from the store, its own
   * default only when nothing is stored). A skip is logged with the switch
   * that gated it, so a stubbed event shows which read decided.
   */
  private policy(behavior: WatchdogBehavior, action: string): boolean {
    const enabled = settingsService.isWatchdogBehaviorEnabled(behavior);
    if (!enabled) {
      log(`policy ${behavior} is off; skipped ${action}`);
    }
    return enabled;
  }

  /** A chain's terminal wake, owed only while the terminal-wakes switch is on. */
  private queueTerminalWake(chain: ChainRecord): void {
    if (!this.policy('terminalWakes', `terminal wake for chain ${chain.slug}`)) {
      return;
    }
    chain.wakePending = true;
    this.persistChain(chain);
    this.queueWake(chain.projectPath, terminalWakePrompt(chain), { chainSlug: chain.slug });
  }

  /** Posts the terminal notice, then queues the separately gated planner wake. */
  private handleTerminalChain(chain: ChainRecord): void {
    const verifySummary = countVerifyVerdicts(chain);
    const unsettled = verifySummary.failed + verifySummary.inconclusive;
    let terminalLabel: string = chain.status;
    if (chain.status === 'completed' && unsettled > 0) {
      terminalLabel = verifySummary.inconclusive === 0
        ? `completed with ${verifySummary.failed} verify ${verifySummary.failed === 1 ? 'failure' : 'failures'}`
        : `completed with ${verifySummary.failed} failed and ${verifySummary.inconclusive} inconclusive verifies`;
    }
    this.notify(
      'decision-needed',
      `Chain ${chain.slug} ${terminalLabel}`,
      terminalWakePrompt(chain),
      { chainSlug: chain.slug, projectPath: chain.projectPath, status: chain.status },
    );
    this.queueTerminalWake(chain);
  }

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
          dispatchingSessionId: row.dispatching_session_id,
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
          fastMode: Boolean(row.fast_mode),
          holdRequested: Boolean(row.hold_requested),
          holdReason: row.hold_reason,
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
        if (chain.status !== 'running' && chain.wakePending
          && this.policy('terminalWakes', `re-derived terminal wake for chain ${chain.slug}`)) {
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
        dispatching_session_id: chain.dispatchingSessionId,
        manifest: chain.manifest ? JSON.stringify(chain.manifest) : null,
        phase_active: chain.phaseActive ? 1 : 0,
        punchlist: chain.punchlist,
        job_meta: Object.keys(chain.jobs).length ? JSON.stringify(chain.jobs) : null,
        wake_pending: chain.wakePending ? 1 : 0,
        fast_mode: chain.fastMode ? 1 : 0,
        hold_requested: chain.holdRequested ? 1 : 0,
        hold_reason: chain.holdReason,
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
    dispatchingSessionId?: string | null;
    phases?: number | null;
    manifest?: ChainManifestEntry[] | null;
    punchlist?: string | null;
  }): void {
    // A re-registration (restart-recovery via an event) without a manifest
    // keeps the chain's current wake anchor; same for the punch list path.
    const existing = this.chains.get(input.slug);
    const dispatchingSessionId = existing?.dispatchingSessionId
      ?? input.dispatchingSessionId
      ?? sessionsDb.resolveWatchdogWakeSession(input.projectPath)?.session_id
      ?? sessionsDb.getLatestPlannerSession(input.projectPath)?.session_id
      ?? null;
    const punchlist = input.punchlist
      ? path.isAbsolute(input.punchlist)
        ? input.punchlist
        : path.join(input.projectPath, input.punchlist)
      : existing?.punchlist ?? null;
    const chain: ChainRecord = {
      slug: input.slug,
      projectPath: input.projectPath,
      dispatchingSessionId,
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
      fastMode: existing?.fastMode ?? false,
      holdRequested: false,
      holdReason: null,
    };
    this.chains.set(input.slug, chain);
    if (!existing && dispatchingSessionId) {
      sessionsDb.setWatchdogWakeTarget(dispatchingSessionId);
    }
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain registered: ${input.slug}`, {
      projectPath: input.projectPath,
      phases: input.phases ?? null,
      dispatchingSessionId,
    });
  }

  /**
   * Replaces a chain's manifest in place (ui13 job 13): label edits mid-run
   * must not go through registerChain, which resets currentPhase/startedAt/
   * phaseActive. Everything except the manifest is left untouched.
   */
  /**
   * Records a unit's verifier session (ui14 job 10) from the runner's
   * pre-announce, so the jobs view can open the verify transcript and the
   * run switcher can tell the verify row from the build row.
   */
  setChainVerifySession(slug: string, phase: number, sessionId: string): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    const meta = chain.jobs[phase] ?? (chain.jobs[phase] = {});
    meta.verifySessionId = sessionId;
    this.persistChain(chain);
    return true;
  }

  /** Records the build stage's engine and model on the unit's job metadata. */
  setChainJobEngine(slug: string, phase: number, engine: string, model: string | null): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    const meta = chain.jobs[phase] ?? (chain.jobs[phase] = {});
    meta.engine = engine;
    if (model) {
      meta.model = model;
    }
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    return true;
  }

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
   * Used by the watchdog remanifest route to repair any stored chain in place
   * from the runner's durable phase-file list and its still-queued appends.
   * The chain registry entry is mutated instead of re-registered so running,
   * completed, and failed state plus job metadata remain intact.
   */
  remanifestChain(
    slug: string,
    projectPath: string,
  ): { status: 'ok'; entries: number } | { status: 'unknown' | 'project-mismatch' | 'unavailable'; message: string } {
    const chain = this.chains.get(slug);
    if (!chain) {
      return { status: 'unknown', message: `Chain "${slug}" is not registered.` };
    }
    if (normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath)) {
      return { status: 'project-mismatch', message: `Chain "${slug}" is not registered for this project.` };
    }

    const runtimeDirectory = chainJournalDir(slug);
    const resumePath = path.join(runtimeDirectory, 'resume.json');
    let phaseFiles: string[];
    try {
      const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8')) as { repo?: unknown; phaseFiles?: unknown };
      if (typeof resume.repo === 'string'
        && normalizeProjectPath(resume.repo) !== normalizeProjectPath(chain.projectPath)) {
        return { status: 'unavailable', message: `${resumePath} belongs to a different project.` };
      }
      phaseFiles = Array.isArray(resume.phaseFiles)
        ? resume.phaseFiles.filter((file): file is string => typeof file === 'string' && file.trim() !== '')
        : [];
    } catch (error) {
      return {
        status: 'unavailable',
        message: `Cannot read ${resumePath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!phaseFiles.length) {
      return { status: 'unavailable', message: `${resumePath} lists no phase files.` };
    }

    const appendDirectory = path.join(runtimeDirectory, 'append');
    try {
      const queuedAppends = fs.readdirSync(appendDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => path.join(appendDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right));
      phaseFiles.push(...queuedAppends);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        return {
          status: 'unavailable',
          message: `Cannot read ${appendDirectory}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    phaseFiles = [...new Set(phaseFiles.map((file) => path.resolve(file)))];

    const rebuilt = manifestFromPhaseFiles(phaseFiles);
    if ('error' in rebuilt) {
      return { status: 'unavailable', message: rebuilt.error };
    }
    chain.manifest = rebuilt.entries;
    chain.phases = rebuilt.entries.length;
    chain.punchlist = rebuilt.punchlist
      ? path.isAbsolute(rebuilt.punchlist)
        ? rebuilt.punchlist
        : path.join(chain.projectPath, rebuilt.punchlist)
      : null;
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain ${slug}: manifest rebuilt from phase files (${rebuilt.entries.length} entries)`);
    return { status: 'ok', entries: rebuilt.entries.length };
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

  /** Used by the watchdog fast route so the dispatch runner can read the latest preference per unit. */
  chainFastMode(slug: string, projectPath?: string): boolean | null {
    const chain = this.chains.get(slug);
    if (!chain || (projectPath && normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath))) {
      return null;
    }
    return chain.fastMode;
  }

  /** Used by the authenticated app and dispatch CLI to persist and broadcast the chain preference. */
  setChainFastMode(slug: string, projectPath: string, enabled: boolean): boolean | null {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath)) {
      return null;
    }
    chain.fastMode = enabled;
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: fast mode ${enabled ? 'on' : 'off'}`);
    return chain.fastMode;
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
   * Amends a queued unit or repairs the executing unit's name/tasks in place
   * (ui18 job 3). Once the executing unit is ticking its anchor is immutable,
   * preserving the punch-list watcher and recorded task boundaries. Finished
   * units remain immutable. Adds no unit, so `phases` is untouched.
   */
  amendChainPhase(
    slug: string,
    phaseIndex: number,
    patch: { tasks?: string[]; name?: string; anchor?: string },
  ): 'ok' | 'unknown' | 'not-queued' | 'anchor-started' | 'invalid' {
    const chain = this.chains.get(slug);
    if (!chain || !chain.manifest) {
      return 'unknown';
    }
    const entry = chain.manifest[phaseIndex - 1];
    const executing = chain.status === 'running'
      && chain.phaseActive
      && phaseIndex === chain.currentPhase;
    const queued = chain.status === 'running' && phaseIndex > (chain.currentPhase ?? 0);
    if (!entry || (!executing && !queued)) {
      return 'not-queued';
    }
    if (executing && patch.anchor) {
      return 'anchor-started';
    }
    const nextName = patch.name ?? entry.name;
    const nextTasks = patch.tasks ?? entry.tasks;
    const nextAnchor = patch.anchor ?? entry.anchor;
    if (!nextName.trim() || !nextTasks.length || nextName.length > MANIFEST_NAME_MAX
      || nextTasks.some((task) => task.length > MANIFEST_TASK_MAX)
      || (nextAnchor?.length ?? 0) > MANIFEST_ANCHOR_MAX) {
      return 'invalid';
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
   * Handles `dispatch pause` for the watchdog route: only a live runner for
   * this project is signaled. The runner owns child shutdown and parking,
   * then posts the `paused` chain event; this method waits for that event so
   * the CLI does not return before the pause is durable.
   */
  async requestChainPause(
    slug: string,
    projectPath: string,
  ): Promise<'paused' | 'not-running' | 'no-runner' | 'timeout'> {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath) || chain.status !== 'running') {
      return 'not-running';
    }
    const runners = await listChainRunners();
    const pid = runners?.get(slug);
    if (pid == null) {
      return 'no-runner';
    }
    try {
      process.kill(pid, 'SIGUSR1');
    } catch {
      return 'no-runner';
    }
    const deadline = Date.now() + CHAIN_PAUSE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = this.chains.get(slug);
      if (current?.status === 'paused') {
        return 'paused';
      }
      if (!current || current.status !== 'running') {
        return 'not-running';
      }
    }
    return 'timeout';
  }

  /**
   * Used by the watchdog hold route for `dispatch hold`: records a promote
   * request without signaling or interrupting the runner. The runner alone
   * consumes it after a committed unit and its verifier have settled.
   */
  requestChainHold(
    slug: string,
    projectPath: string,
    reason: string,
  ): 'holding' | 'not-running' {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath) || chain.status !== 'running') {
      return 'not-running';
    }
    chain.holdRequested = true;
    chain.holdReason = reason;
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: hold requested`, { reason });
    return 'holding';
  }

  /**
   * Used by the runner's boundary read route. A missing or wrong-project
   * chain returns null so an unauthenticated slug can never leak state.
   */
  chainHold(slug: string, projectPath: string): { requested: boolean; reason: string | null } | null {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath)) {
      return null;
    }
    return { requested: chain.holdRequested, reason: chain.holdReason };
  }

  /**
   * Used by promote's timeout cleanup. A still-running chain has its pending
   * flag cleared; an already-held chain is reported so the unchanged resume
   * path can restart it from the next unit.
   */
  releaseChainHold(
    slug: string,
    projectPath: string,
  ): 'cleared' | 'held' | 'not-holding' {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath)) {
      return 'not-holding';
    }
    if (chain.status === 'paused' && chain.holdReason === 'promote') {
      return 'held';
    }
    if (chain.status !== 'running' || !chain.holdRequested) {
      return 'not-holding';
    }
    chain.holdRequested = false;
    chain.holdReason = null;
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    log(`chain ${slug}: hold released before boundary`);
    return 'cleared';
  }

  /**
   * Handles `dispatch resume` for the watchdog route: transitions the same
   * paused record back to running and returns the first job with no recorded
   * commit. Manifest, job metadata, unit count, and chain identity stay put.
   */
  resumeChain(
    slug: string,
    projectPath: string,
  ): { phase: number; phases: number } | null {
    const chain = this.chains.get(slug);
    if (!chain || normalizeProjectPath(chain.projectPath) !== normalizeProjectPath(projectPath) || chain.status !== 'paused') {
      return null;
    }
    const phases = chain.manifest?.length ?? chain.phases ?? 0;
    let phase = 1;
    while (phase <= phases && chain.jobs[phase]?.commitHash) {
      phase += 1;
    }
    chain.status = 'running';
    chain.phaseActive = false;
    chain.holdRequested = false;
    chain.holdReason = null;
    chain.lastEventAt = Date.now();
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain ${slug}: resumed`, { phase, phases });
    return { phase, phases };
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
    const file = chain.currentPhase == null
      ? null
      : this.punchlistSections(chain)[chain.currentPhase - 1]?.file ?? null;
    if (chain.status !== 'running' || !file
      || !this.policy('punchlistWatching', `punch list watch for chain ${chain.slug}`)) {
      if (active) {
        active.watcher.close();
        if (active.timer) {
          clearTimeout(active.timer);
        }
        this.punchlistWatchers.delete(chain.slug);
      }
      return;
    }
    if (active?.file === file) {
      return;
    }
    if (active) {
      active.watcher.close();
      if (active.timer) {
        clearTimeout(active.timer);
      }
      this.punchlistWatchers.delete(chain.slug);
    }
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
      this.punchlistWatchers.set(chain.slug, { watcher, timer: null, mtimeMs: mtimeOf(), file });
    } catch (error) {
      log(`chain ${chain.slug}: cannot watch punch list ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Resolves every manifest entry to the punch-list section that owns its
   * tasks. Explicit manifest metadata wins. Planner manifests historically
   * omit both fields, so the fallback reads the already-cached unit identity
   * parsed from `Execute Job N of PUNCHLIST_x.md` in that unit's prompt.
   */
  private punchlistSections(chain: ChainRecord): Array<PunchlistSection | null> {
    if (!chain.manifest) {
      return [];
    }
    const identities = this.twinIdentities.identities({
      slug: chain.slug,
      projectPath: chain.projectPath,
      units: chain.manifest.length,
    });
    return chain.manifest.map((entry, index) => {
      const promptReference = promptPunchlistReference(identities[index]?.key ?? null, chain.projectPath);
      const file = chain.punchlist ?? promptReference?.file ?? null;
      if (!file) {
        return null;
      }
      if (entry.anchor) {
        return { file, anchor: entry.anchor };
      }
      return promptReference ? { file, unitNumber: promptReference.unitNumber } : null;
    });
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
      const observedAfterStart = Math.max(0, count - (meta.taskDoneBaseline ?? 0));
      const live = chain.status === 'running' && chain.phaseActive && chain.currentPhase === i + 1;
      while (meta.taskTimes.length < observedAfterStart) {
        meta.taskTimes.push(live ? Date.now() : null);
        changed = true;
      }
    }
    if (changed) {
      this.persistChain(chain);
    }
  }

  /**
   * Units hidden as twins across a project's chains (codex job 5), keyed
   * slug → unit → winner. Recomputed when any chain's state changes; the
   * hidden-row counts are logged once per change, and no row is deleted.
   */
  private hiddenTwins(projectPath: string): Map<string, Map<number, string>> {
    const chains: TwinChain[] = [];
    for (const chain of this.chains.values()) {
      if (chain.projectPath === projectPath) {
        chains.push({
          slug: chain.slug,
          projectPath: chain.projectPath,
          status: chain.status,
          currentPhase: chain.currentPhase,
          startedAt: chain.startedAt,
          units: chain.manifest?.length ?? Math.max(chain.phases ?? 0, chain.currentPhase ?? 0),
          verifyFailedUnits: new Set(
            Object.entries(chain.jobs)
              .filter(([, meta]) => meta.verify === 'failed')
              .map(([index]) => Number(index)),
          ),
        });
      }
    }
    const signature = chains.map((chain) => (
      `${chain.slug}:${chain.status}:${chain.currentPhase}:${chain.units}:${[...(chain.verifyFailedUnits ?? [])].join(',')}`
    )).join('|');
    const cached = this.twinResults.get(projectPath);
    if (cached && cached.signature === signature) {
      return cached.hidden;
    }
    const hiddenUnits = hiddenTwinUnits(chains, (chain) => this.twinIdentities.identities(chain));
    const hidden = new Map<string, Map<number, string>>();
    for (const unit of hiddenUnits) {
      const bySlug = hidden.get(unit.slug) ?? new Map<number, string>();
      bySlug.set(unit.index, unit.supersededBy);
      hidden.set(unit.slug, bySlug);
    }
    const summary = summarizeHidden(hiddenUnits);
    if (summary !== cached?.summary) {
      log(`twins hidden for ${projectPath}: ${summary || 'none'} (${hiddenUnits.length} rows hidden, 0 deleted)`);
    }
    this.twinResults.set(projectPath, { signature, hidden, summary });
    return hidden;
  }

  private chainSnapshot(chain: ChainRecord): ChainSnapshot {
    // Per-unit done counts come from the punch list file, re-read here on
    // every snapshot — so each chain event's broadcast and each worker-runs
    // fetch (the 20s poll catches mid-phase commits) carries fresh counts.
    const rawDoneCounts = punchlistDoneCounts(chain.manifest, this.punchlistSections(chain));
    this.observeTaskCheckoffs(chain, rawDoneCounts);
    const doneCounts = rawDoneCounts?.map((count, index) => {
      if (count == null) return null;
      return Math.max(0, count - (chain.jobs[index + 1]?.taskDoneBaseline ?? 0));
    }) ?? null;
    const hidden = this.hiddenTwins(chain.projectPath).get(chain.slug);
    return {
      slug: chain.slug,
      projectPath: chain.projectPath,
      status: chain.status,
      phases: chain.phases,
      currentPhase: chain.currentPhase,
      phaseActive: chain.phaseActive,
      fastMode: chain.fastMode,
      holdRequested: chain.holdRequested,
      holdReason: chain.holdReason,
      verifyFailures: countVerifyVerdicts(chain).failed,
      verifySummary: countVerifyVerdicts(chain),
      manifest: chain.manifest
        ? chain.manifest.map((entry, i) => {
            const { taskDoneBaseline: _taskDoneBaseline, ...publicJobMeta } = chain.jobs[i + 1] ?? {};
            return {
              ...entry,
              done: doneCounts?.[i] ?? null,
              ...publicJobMeta,
              ...(hidden?.has(i + 1) ? { hidden: true as const, supersededBy: hidden.get(i + 1) } : {}),
            };
          })
        : null,
      orphanedAppends: countQueuedAppends(chain.slug),
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
    event: ChainEventName,
    detail?: {
      phase?: number;
      summaryTail?: string;
      commit?: { hash: string; subject: string };
      quiet?: boolean;
      fastMode?: boolean;
      verdict?: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
      suiteStatus?: 'green' | 'red';
      suiteFailures?: string[];
    },
  ): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    chain.lastEventAt = Date.now();
    if (event === 'paused' || event === 'held') {
      chain.status = 'paused';
      chain.phaseActive = false;
      if (event === 'paused') {
        chain.holdRequested = false;
        chain.holdReason = null;
      } else {
        chain.holdRequested = true;
        chain.holdReason = 'promote';
      }
      if (detail?.summaryTail) {
        chain.lastSummaryTail = detail.summaryTail.slice(-2000);
      }
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      this.syncPunchlistWatcher(chain);
      log(`chain ${slug}: ${event}`, { phase: chain.currentPhase });
      return true;
    }
    // The post-commit server suite is recorded on its unit but never changes
    // chain state. A red tree remains visible while later repair units run.
    if (event === 'suite-end') {
      if (typeof detail?.phase === 'number' && detail.suiteStatus) {
        const meta = chain.jobs[detail.phase] ?? (chain.jobs[detail.phase] = {});
        meta.suite = detail.suiteStatus;
        meta.suiteFailures = detail.suiteStatus === 'red' ? (detail.suiteFailures ?? []).slice(0, 20) : [];
      }
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      log(`chain ${slug}: suite-end`, {
        phase: detail?.phase ?? null,
        suite: detail?.suiteStatus ?? null,
        failures: detail?.suiteFailures ?? [],
      });
      return true;
    }
    // Verify-stage events belong to a unit whose build already ended. They
    // never move currentPhase or phaseActive, which track the build in flight.
    // Every settled verdict travels on verify-end. The legacy verify-failed
    // event remains readable for old runners, but no settled state is inferred
    // from a bare event except the old verify-end=PASS compatibility path.
    if (event === 'verify-start' || event === 'verify-end' || event === 'verify-failed') {
      if (typeof detail?.phase === 'number') {
        const meta = chain.jobs[detail.phase] ?? (chain.jobs[detail.phase] = {});
        if (event === 'verify-start') {
          meta.verify = 'running';
          meta.verifyStartedAt = Date.now();
          delete meta.verifyEndedAt;
          delete meta.verifyReason;
        } else {
          const verdict = event === 'verify-failed' ? 'FAIL' : (detail?.verdict ?? 'PASS');
          meta.verify = verdict === 'PASS' ? 'passed' : verdict === 'FAIL' ? 'failed' : 'inconclusive';
          meta.verifyEndedAt = Date.now();
          if (verdict !== 'PASS' && detail?.summaryTail) {
            meta.verifyReason = detail.summaryTail.slice(-2000);
          }
          if (verdict === 'FAIL' && detail?.summaryTail) {
            meta.failureReason = detail.summaryTail.slice(-2000);
          }
        }
      }
      if (detail?.summaryTail && event !== 'verify-failed') {
        chain.lastSummaryTail = detail.summaryTail.slice(-2000);
      }
      log(`chain ${slug}: ${event}`, { phase: detail?.phase ?? null, status: chain.status });
      const failedVerdict = event === 'verify-failed' || (event === 'verify-end' && detail?.verdict === 'FAIL');
      if (failedVerdict) {
        this.persistChain(chain);
        this.broadcastChainProgress(chain);
        const phase = detail?.phase;
        const meta = typeof phase === 'number' ? chain.jobs[phase] : undefined;
        const unitName = typeof phase === 'number' ? chain.manifest?.[phase - 1]?.name : undefined;
        const reason = meta?.failureReason ?? 'The verifier reported a failure without a reason.';
        this.notify(
          'decision-needed',
          `Chain ${slug} job ${phase ?? '?'} verify failed`,
          `Job ${phase ?? '?'}${chain.phases ? ` of ${chain.phases}` : ''}${unitName ? ` (${unitName})` : ''} failed verification: ${reason}\n\nThe chain is continuing. Append a fix unit at the terminal wake's resume point.`,
          { chainSlug: slug, projectPath: chain.projectPath, status: 'verify-failed', phase },
        );
      } else {
        this.persistChain(chain);
        this.broadcastChainProgress(chain);
      }
      return true;
    }
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
        const doneCounts = punchlistDoneCounts(chain.manifest, this.punchlistSections(chain));
        meta.taskDoneBaseline = doneCounts?.[detail.phase - 1] ?? 0;
        meta.fastMode = detail.fastMode === true;
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
      if ((event === 'failed' || event === 'stopped') && chain.currentPhase != null) {
        const meta = chain.jobs[chain.currentPhase] ?? (chain.jobs[chain.currentPhase] = {});
        meta.failureReason = chain.lastSummaryTail;
      }
    }
    // Honest run state: a phase session is live only between phase-start and
    // phase-end/terminal — never inferred from a session row's age.
    chain.phaseActive = event === 'phase-start';
    log(`chain ${slug}: ${event}`, { phase: chain.currentPhase, status: chain.status });

    // Session-limit auto-recovery (ui10 phase 1): not a failure. The runner
    // is switching accounts or waiting out the reset, then retrying the
    // phase; the chain stays running and the notice says so explicitly.
    if (event === 'limit') {
      void accountUsageMonitor.refresh('limit').catch((error) => {
        log(`account usage refresh after chain limit failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      // A Codex usage-limit wait (codex job 2) is announced through a
      // recovery notification instead; the event only records the wait.
      if (detail?.quiet || !this.policy('recoveryNotices', `limit recovery notice for chain ${slug}`)) {
        return true;
      }
      const tail = chain.lastSummaryTail ? `\n\nRecovery detail:\n${chain.lastSummaryTail}` : '';
      this.notify(
        'recovery',
        `Chain ${slug} is auto-recovering`,
        `The dispatched chain hit the session limit${chain.phases ? ` at job ${chain.currentPhase ?? '?'} of ${chain.phases}` : ''} `
        + `and is switching accounts or waiting for a reset before retrying. No action is needed.${tail}`,
        { chainSlug: slug, projectPath: chain.projectPath, status: 'recovering' },
      );
      return true;
    }

    if (event === 'completed' || event === 'stopped' || event === 'failed') {
      chain.status = event === 'completed' ? 'completed' : event === 'stopped' ? 'stopped' : 'failed';
      settleRunningVerifies(chain);
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      this.syncPunchlistWatcher(chain);
      this.handleTerminalChain(chain);
    } else {
      this.persistChain(chain);
      this.broadcastChainProgress(chain);
      // A newly started unit may be the first moment an appended prompt is
      // available to derive its punch-list path. Re-anchor the directory
      // watcher on every live boundary so that unit's check-offs stream.
      this.syncPunchlistWatcher(chain);
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
    if (!chainSlug && this.policy('terminalWakes', `run-ended wake for session ${sessionId}`)) {
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
    // Jobs is a history surface, not a recent-run switcher. Keep enough rows
    // to cover completed chains and both provider types; file totals are
    // metadata-cached by size/mtime in the token service.
    const rows = sessionsDb.listWorkerSessions(normalizedPath, 100);

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
        startedAt: run.startedAt,
        lastActivity: new Date(run.lastEventAt).toISOString(),
        tokenCount: null,
        cacheReadCount: null,
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
      // A verify-stage session (ui14 job 10) is live while its unit's verify
      // runs, independent of the build the chain has moved on to.
      const verifyMeta = chain && row.chain_phase != null ? chain.jobs[row.chain_phase] : undefined;
      const isVerify = Boolean(verifyMeta?.verifySessionId && verifyMeta.verifySessionId === row.session_id);
      const chainActive = isVerify
        ? Boolean(chain && chain.status === 'running' && verifyMeta?.verify === 'running')
        : Boolean(
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
        ...(isVerify ? { chainStage: 'verify' as const } : {}),
        title,
        state,
        model: row.model ?? live?.model ?? null,
        startedAt: row.created_at ?? live?.startedAt ?? null,
        lastActivity: row.updated_at ?? row.created_at ?? null,
        tokenCount: null,
        cacheReadCount: null,
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
   * Enriches the jobs-history snapshot with provider-source token totals. The
   * providers route uses this async form; the sync form remains available to
   * watchdog tests and internal callers that do not need filesystem totals.
   */
  async listWorkerRunsWithTokens(
    projectPath: string,
  ): Promise<{ runs: WorkerRun[]; chains: Record<string, ChainSnapshot> }> {
    const snapshot = this.listWorkerRuns(projectPath);
    const runs = await Promise.all(snapshot.runs.map(async (run) => {
      try {
        const usage = await providerTokenUsageService.getJobTokenUsage(run.sessionId);
        return {
          ...run,
          tokenCount: usage?.totalTokens ?? null,
          cacheReadCount: usage?.cacheReadTokens ?? null,
        };
      } catch (error) {
        console.warn('Could not read worker run token usage', {
          sessionId: run.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return run;
      }
    }));
    return { ...snapshot, runs };
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
    const runs = [...this.dispatchRuns.values()]
      .filter((run) => !run.ended && now - run.lastEventAt < STUCK_SILENCE_MS)
      .map((run) => ({ sessionId: run.sessionId, provider: run.provider, startedAt: run.startedAt }));
    // Chain-runner sessions (codex job 5) never pass through the in-server
    // run registry, so the beam and counters read them off the chain
    // registry with the worker pane's liveness rule: the current unit's
    // build session while the phase is active, and any unit's verify session
    // while its verify runs. A dead runner is settled by the liveness sweep.
    const seen = new Set(runs.map((run) => run.sessionId));
    for (const chain of this.chains.values()) {
      if (chain.status !== 'running') {
        continue;
      }
      const verifying = new Map<string, number>();
      for (const [unit, meta] of Object.entries(chain.jobs)) {
        if (meta.verify === 'running' && meta.verifySessionId) {
          verifying.set(meta.verifySessionId, Number(unit));
        }
      }
      const buildLive = chain.phaseActive && chain.currentPhase != null;
      if (!buildLive && !verifying.size) {
        continue;
      }
      for (const row of sessionsDb.listChainSessions(chain.slug)) {
        if (seen.has(row.session_id)) {
          continue;
        }
        const verifyUnit = verifying.get(row.session_id);
        let startedAt: number | null = null;
        if (verifyUnit != null) {
          startedAt = chain.jobs[verifyUnit]?.verifyStartedAt ?? chain.lastEventAt;
        } else if (buildLive && row.chain_phase === chain.currentPhase) {
          startedAt = chain.jobs[chain.currentPhase as number]?.startedAt ?? chain.lastEventAt;
        }
        if (startedAt == null) {
          continue;
        }
        seen.add(row.session_id);
        runs.push({ sessionId: row.session_id, provider: row.provider, startedAt });
      }
    }
    return runs;
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

  /**
   * Used by the watchdog notify route for promote.sh: inserts before the
   * first gate and updates the same durable row as the attempt advances.
   */
  recordPromoteAttempt(input: {
    attemptId?: number;
    projectPath: string;
    promotedCommit: string;
    previousLiveCommit: string;
    dryRun: boolean;
    stage: string;
    status: 'running' | 'passed' | 'failed' | 'rolled_back';
    logPath: string;
    failureDetail?: string;
  }): {
    id: number;
    projectPath: string;
    promotedAt: number;
    startedAt: number;
    endedAt: number | null;
    promotedCommit: string;
    previousLiveCommit: string;
    dryRun: boolean;
    stage: string;
    status: 'running' | 'passed' | 'failed' | 'rolled_back';
    logPath: string;
    failureDetail: string | null;
  } | null {
    const now = Date.now();
    const endedAt = input.status === 'running' ? null : now;
    const promotedAt = endedAt ?? now;
    const projectPath = normalizeProjectPath(input.projectPath);
    const row = {
      project_path: projectPath,
      promoted_at: promotedAt,
      ended_at: endedAt,
      promoted_commit: input.promotedCommit,
      previous_live_commit: input.previousLiveCommit,
      dry_run: input.dryRun ? 1 : 0,
      stage: input.stage,
      status: input.status,
      log_path: input.logPath,
      failure_detail: input.failureDetail?.slice(-2000) ?? null,
    };
    const id = input.attemptId ?? watchdogDb.createPromoteAttempt({
      ...row,
      started_at: now,
    });
    if (input.attemptId && !watchdogDb.updatePromoteAttempt({ id, ...row })) {
      return null;
    }
    const stored = watchdogDb.listPromotes(projectPath).find((candidate) => candidate.id === id);
    if (!stored) return null;
    log(`promote attempt recorded: ${input.promotedCommit}`, {
      id,
      projectPath,
      stage: input.stage,
      status: input.status,
      dryRun: input.dryRun,
    });
    const record = {
      id,
      projectPath,
      promotedAt: stored.promoted_at,
      startedAt: stored.started_at,
      endedAt: stored.ended_at,
      promotedCommit: stored.promoted_commit,
      previousLiveCommit: stored.previous_live_commit,
      dryRun: Boolean(stored.dry_run),
      stage: stored.stage,
      status: stored.status as 'running' | 'passed' | 'failed' | 'rolled_back',
      logPath: stored.log_path,
      failureDetail: stored.failure_detail,
    };
    // The jobs column draws every attempt from this feed, so stage and result
    // changes land without waiting for a poll.
    const event = JSON.stringify({ kind: 'promote_recorded', promote: record });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(event);
      }
    });
    return record;
  }

  /** Supplies the watchdog promotes route consumed by the jobs history. */
  listPromotes(projectPath: string) {
    return watchdogDb.listPromotes(normalizeProjectPath(projectPath)).map((row) => ({
      id: row.id,
      projectPath: row.project_path,
      promotedAt: row.promoted_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      promotedCommit: row.promoted_commit,
      previousLiveCommit: row.previous_live_commit,
      dryRun: Boolean(row.dry_run),
      stage: row.stage,
      status: row.status,
      logPath: row.log_path,
      failureDetail: row.failure_detail,
    }));
  }

  // ----- notifications (spec B8: decision-needed and verified-done broadcast
  // everywhere; recovery (codex job 2) is the quiet third for limit waits) -----

  notify(
    kind: 'decision-needed' | 'verified-done' | 'recovery',
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

  queueWake(
    projectPath: string,
    prompt: string,
    options: { freshBoot?: boolean; chainSlug?: string; targetSessionId?: string } = {},
  ): void {
    const queue = this.wakeQueues.get(projectPath) ?? { prompts: [], draining: false };
    queue.prompts.push({
      prompt,
      freshBoot: options.freshBoot,
      chainSlug: options.chainSlug,
      targetSessionId: options.targetSessionId,
      failures: 0,
    });
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
        const item = queue.prompts[0];
        const chain = item.chainSlug ? this.chains.get(item.chainSlug) : undefined;
        const lineageAnchor = chain?.dispatchingSessionId ?? item.targetSessionId ?? null;
        const resolution = sessionsDb.resolveWatchdogWakeTarget(projectPath, lineageAnchor);
        const planner = resolution.session;
        if (!planner) {
          log(`no planner session found for ${projectPath}; escalating ${queue.prompts.length} wake(s) to decision-needed`);
          this.wakeUndeliverable(projectPath, queue.prompts.splice(0), 'No planner session exists for this project');
          break;
        }

        if (chain && resolution.usedFallback && chain.dispatchingSessionId !== planner.session_id) {
          const previousSessionId = chain.dispatchingSessionId ?? 'none';
          chain.dispatchingSessionId = planner.session_id;
          watchdogDb.updateChainDispatchingSession(chain.slug, planner.session_id);
          appendChainJournalLine(
            chain.slug,
            'watchdog',
            'wake-reroute',
            `dispatching session ${previousSessionId} was dead; updated to live planner ${planner.session_id}`,
          );
          log(`chain ${chain.slug}: wake target moved to live planner`, {
            from: previousSessionId,
            to: planner.session_id,
          });
        }

        // RUN_IN_PROGRESS: hold the wake and retry until the planner is idle.
        const running = chatRunRegistry
          .listRunningRuns()
          .some((run: { sessionId: string }) => run.sessionId === planner.session_id);
        // A row reserved for a handoff (or mid-boot) has no run yet but is not
        // a chat that can take a wake: hold until its boot settles (ui17 job 17).
        if (running || this.isRuntimeBusy(planner.session_id) || planner.boot_state === 'pending') {
          log(`planner ${planner.session_id} is mid-turn; retrying wake in ${WAKE_RETRY_MS / 1000}s`);
          setTimeout(() => {
            queue.draining = false;
            void this.drainWakes(projectPath);
          }, WAKE_RETRY_MS).unref?.();
          return;
        }

        log(`waking planner ${planner.session_id} for ${projectPath}${item.freshBoot ? ' (fresh boot)' : ''}`);

        // Fresh boots run as a registered app session (ui11 phase 3): the row
        // exists before the run (origin planner, booted), the stream goes out
        // through the run registry so every client can follow it live, and a
        // planner_handoff frame tells clients viewing the old session to
        // switch. A failed boot persists as boot_state 'failed' (Willem
        // retries from the UI) instead of retrying into more session rows.
        if (item.freshBoot) {
          try {
            if (!await this.bootFreshPlanner(projectPath, planner.session_id, item.prompt)) {
              throw new Error('fresh planner boot failed');
            }
            queue.prompts.shift();
            this.wakeSettled(item);
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
          continue;
        }

        try {
          // Resume by provider-native id, but only when a transcript actually
          // exists on disk; otherwise boot a fresh planner session — the
          // planner is stateless by design and re-grounds from STATE.md.
          const resumeId = planner.jsonl_path ? planner.provider_session_id : null;
          const result = await this.runPlannerTurn(
            planner.provider as LLMProvider,
            resumeId,
            planner.model,
            planner.effort,
            projectPath,
            item.prompt,
          );
          if (result.errored && resumeId && /no conversation found/i.test(result.errorMessage ?? '')) {
            log(`planner session ${planner.session_id} is dead; booting a fresh planner`);
            if (!await this.bootFreshPlanner(projectPath, planner.session_id, item.prompt)) {
              throw new Error('fresh planner boot failed');
            }
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
    provider: LLMProvider,
    providerSessionId: string | null,
    model: string | null,
    effort: string | null,
    projectPath: string,
    prompt: string,
    onAnnounced?: (announcedSessionId: string) => void,
  ): Promise<{ errored: boolean; errorMessage: string | null; announcedSessionId: string | null }> {
    const runner = providerRuntimeService.getRunner(provider);
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
      wrapMachineMessage(prompt, 'watchdog'),
      {
        projectPath,
        cwd: projectPath,
        sessionId: providerSessionId,
        model: model || undefined,
        effort: effort || undefined,
        permissionMode: 'bypassPermissions',
        mcpPolicy: 'none',
      },
      writer,
    );
    return { errored: errorMessage !== null, errorMessage, announcedSessionId: announcedId };
  }

  /**
   * A planner session's /handoff turn has just started (Handoff button or
   * typed /handoff): the successor row is created now, not when the turn ends
   * (ui17 job 17). Willem's click is the consent, so there is no policy gate —
   * the row appears in the sidebar and the pane switches to it with the boot
   * loader while /handoff still runs in the old session. Returns the reserved
   * session id, or null when the row could not be created (the handoff itself
   * runs either way).
   */
  plannerHandoffBegin(projectPath: string, fromSessionId: string): string | null {
    const reserved = this.reserveFreshPlanner(projectPath, fromSessionId, readPlannerBootPrompt());
    if (!reserved) {
      return null;
    }
    this.announcePlannerHandoff(projectPath, fromSessionId, reserved.sessionId);
    return reserved.sessionId;
  }

  /**
   * A planner session's /handoff turn completed cleanly (Handoff button or
   * typed /handoff): the push check gates the boot, then the reserved
   * successor boots with /planner in the row the click already put on screen.
   * A handoff with no reserved row (an older client, or a reservation that
   * failed) still boots through the rotation's fresh-boot wake.
   */
  async plannerHandoffComplete(
    projectPath: string,
    fromSessionId: string,
    successorSessionId: string | null = null,
  ): Promise<void> {
    const pushProblem = await this.checkHandoffPushed(projectPath).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`handoff push check failed for ${projectPath}: ${message}`);
      return `the push check could not run (${message})`;
    });
    if (pushProblem) {
      this.plannerHandoffFailed(
        successorSessionId,
        `The handoff ran but ${pushProblem}, so the new planner was not started.`,
      );
      return;
    }
    if (!successorSessionId) {
      this.queueWake(projectPath, readPlannerBootPrompt(), { freshBoot: true, targetSessionId: fromSessionId });
      return;
    }
    const booted = await this.runReservedPlannerBoot(successorSessionId, projectPath, readPlannerBootPrompt());
    if (!booted) {
      this.notify(
        'decision-needed',
        'Handoff successor did not boot',
        `The /handoff for ${normalizeProjectPath(projectPath)} landed but its replacement planner failed to boot. `
        + 'Retry the boot from the placeholder chat.',
        { projectPath },
      );
    }
  }

  /**
   * The /handoff turn errored or was aborted (or its push check refused): the
   * placeholder row stays exactly where it is and says what went wrong in one
   * line, on screen now and after a reload. The old session is never touched.
   */
  plannerHandoffFailed(successorSessionId: string | null, reason: string): void {
    if (!successorSessionId) {
      return;
    }
    sessionsDb.setSessionBootState(successorSessionId, 'failed', reason);
    const event = JSON.stringify({
      kind: 'planner_handoff_failed',
      toSessionId: successorSessionId,
      reason,
      timestamp: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(event);
      }
    });
    log(`handoff successor ${successorSessionId} marked failed: ${reason}`);
  }

  /**
   * A handoff that ended cleanly but left planner/<project> uncommitted or
   * the memory repo unpushed (audit 2.8) fires decision-needed: the other
   * machines would otherwise boot from a stale STATE.md with no signal. The
   * problem line is returned too, because it also gates the successor's boot
   * (ui17 job 17) — a handoff that did not land must not be replaced by a
   * planner that would re-ground from the stale file.
   */
  private async checkHandoffPushed(projectPath: string): Promise<string | null> {
    const normalized = normalizeProjectPath(projectPath);
    const project = projectsDb.getProjectPaths().find((row) => normalizeProjectPath(row.project_path) === normalized);
    const memoryFolder = project?.planner_memory_name?.trim() || path.basename(normalized);
    const repoRoot = path.dirname(PLANNER_MEMORY_ROOT);
    const problem = await findUnpushedHandoff(repoRoot, memoryFolder);
    if (!problem) {
      return null;
    }
    this.notify(
      'decision-needed',
      'Handoff did not push',
      `The /handoff for ${normalized} ended but ${problem}. Push ${repoRoot} by hand so the other machines see this handoff.`,
      { projectPath: normalized },
    );
    return problem;
  }

  /**
   * Creates the session row a fresh planner will boot into, without running
   * anything: origin planner, booted, placeholder title, predecessor set, and
   * the sticky provider/model/effort recorded so its own successor inherits
   * them. Split out of the boot (ui17 job 17) because a Handoff click reserves
   * the row at once and only boots it when the /handoff turn has landed.
   * Returns null when the row could not be created.
   */
  private reserveFreshPlanner(
    projectPath: string,
    fromSessionId: string,
    prompt: string,
  ): { sessionId: string; provider: LLMProvider; model: string; effort: string } | null {
    try {
      // Sticky provider, model and effort: the previous planner row's trio,
      // else the Models default. Recorded on the new row so its successor
      // inherits it; a Codex row makes the successor a Codex session, whose
      // transcript then renders through the rollout parser.
      const spawn = settingsService.resolveSpawnSelection('planner', null, projectPath, null);
      const provider = spawn.provider as LLMProvider;
      const sessionId = sessionsService.createAppSession(provider, projectPath, prompt, 'planner', true).sessionId;
      sessionsDb.setSessionPredecessor(sessionId, fromSessionId);
      sessionsDb.markSessionBooted(sessionId);
      if (spawn.model) {
        sessionsDb.setSessionModel(sessionId, spawn.model);
      }
      sessionsDb.setSessionEffort(sessionId, spawn.effort);
      log(`fresh planner ${sessionId} spawn options: provider=${provider} model=${spawn.model || '(runtime default)'} effort=${spawn.effort} (${spawn.source})`);
      return { sessionId, provider, model: spawn.model, effort: spawn.effort };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`fresh planner boot setup failed for ${projectPath}: ${message}`);
      return null;
    }
  }

  /**
   * Tells every client that `toSessionId` is the successor of `fromSessionId`:
   * the pane viewing the outgoing session switches to the new row and holds a
   * loader until its opening message lands.
   */
  private announcePlannerHandoff(projectPath: string, fromSessionId: string, toSessionId: string): void {
    const handoffEvent = JSON.stringify({
      kind: 'planner_handoff',
      projectPath,
      fromSessionId,
      toSessionId,
      timestamp: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(handoffEvent);
      }
    });
  }

  /**
   * Runs the boot prompt inside an already-reserved planner row as a
   * registered app run (ui11 phase 3), so the stream reaches every client that
   * is already watching the row. Returns false on failure; the failed row
   * keeps its predecessor but never becomes the project's wake target.
   */
  private async runReservedPlannerBoot(
    sessionId: string,
    projectPath: string,
    prompt: string,
  ): Promise<boolean> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      log(`reserved planner session ${sessionId} is gone; nothing to boot`);
      return false;
    }
    const provider = session.provider as LLMProvider;
    const run = chatRunRegistry.startRun({
      appSessionId: sessionId,
      provider,
      providerSessionId: null,
      userId: null,
    });
    if (!run) {
      log(`fresh planner session ${sessionId} already has a run in progress`);
      return false;
    }

    let runtimeThrew = false;
    try {
      await providerRuntimeService.run(
        provider,
        wrapMachineMessage(prompt, 'watchdog'),
        {
          sessionId,
          cwd: projectPath,
          projectPath,
          model: session.model || undefined,
          effort: session.effort || undefined,
          permissionMode: 'bypassPermissions',
          bootPrompt: true,
          mcpPolicy: 'none',
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
      sessionsDb.setSessionBootState(
        sessionId,
        failed ? 'failed' : 'ready',
        failed ? 'The replacement planner failed to start.' : null,
      );
      if (!failed) {
        sessionsDb.setWatchdogWakeTarget(sessionId);
      }
      log(`fresh planner ${sessionId} booted for ${projectPath}${failed ? ' (FAILED)' : ''}`);
      return !failed;
    }
  }

  /**
   * Boots a brand-new planner session in one step: reserve the row, announce
   * the handoff, run the boot. The rotation sweep and the dead-session
   * fallback use this; a Handoff click reserves and boots separately.
   */
  private async bootFreshPlanner(
    projectPath: string,
    fromSessionId: string,
    prompt: string,
  ): Promise<boolean> {
    const reserved = this.reserveFreshPlanner(projectPath, fromSessionId, prompt);
    if (!reserved) {
      return false;
    }
    this.announcePlannerHandoff(projectPath, fromSessionId, reserved.sessionId);
    return this.runReservedPlannerBoot(reserved.sessionId, projectPath, prompt);
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
        if (!this.policy('dispatchRunLiveness', `silence wake for dispatched run ${run.sessionId}`)) {
          continue;
        }
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
    if (!running.length || !this.policy('livenessSweep', `liveness sweep of ${running.length} running chain(s)`)) {
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
    settleRunningVerifies(chain);
    chain.lastEventAt = Date.now();
    chain.lastSummaryTail = reason;
    this.persistChain(chain);
    this.broadcastChainProgress(chain);
    this.syncPunchlistWatcher(chain);
    log(`chain ${chain.slug}: stopped by the liveness sweep`, { reason });
    this.handleTerminalChain(chain);
  }

  // ----- planner auto-rotation (spec B7): /handoff at the context threshold -----

  private async checkPlannerRotation(): Promise<void> {
    const threshold = settingsService.plannerRotationThreshold();

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
        if (!this.policy('plannerRotation', `rotation of planner ${planner.session_id} at ${pct.toFixed(0)}%`)) {
          continue;
        }
        this.rotatedSessions.add(planner.session_id);
        log(`planner ${planner.session_id} at ${pct.toFixed(1)}% of its window (threshold ${threshold}%); rotating`);
        this.queueWake(
          planner.project_path,
          `Watchdog: this planner session's context usage is ${pct.toFixed(0)}% of the model's real window `
          + `(threshold ${threshold}%). Run /handoff now per doctrine: file the handoff, refresh STATE.md, `
          + 'commit and push planner memory. A fresh planner will boot from STATE.md right after.',
          { targetSessionId: planner.session_id },
        );
        this.queueWake(planner.project_path, readPlannerBootPrompt(), {
          freshBoot: true,
          targetSessionId: planner.session_id,
        });
      } catch {
        // usage may be unavailable for sessions without transcripts; skip
      }
    }
  }

  private async checkResources(now: number): Promise<void> {
    try {
      const stats = await fsp.statfs('/');
      const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
      if (freeGb < MIN_FREE_DISK_GB && this.policy('resourceAlerts', 'low disk alert') && this.shouldAlert('disk', now)) {
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
      if (freePct !== null && freePct < MIN_FREE_MEM_PCT && this.policy('resourceAlerts', 'memory pressure alert') && this.shouldAlert('memory', now)) {
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
   * Dispatches the weekly maintenance run into the Command Center project: upstream
   * delta classification with backend-safe auto-apply through the dispatch →
   * dev-verify → promote loop, plus the Claude Code CLI version assessment.
   * Silent when safe, decision-needed when judgment-shaped, silence when
   * there is nothing. classifyOnly runs the same checks but applies nothing —
   * the manual-trigger test mode.
   */
  async runMaintenance(classifyOnly = false): Promise<{ started: boolean }> {
    const repo = readRenamedEnvironmentVariable('REPO') || getLegacyProjectDirectory();
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
        const result = await this.runPlannerTurn('claude', null, null, null, repo, prompt, tagMaintenanceSession);
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
      if (this.policy('weeklyMaintenance', 'the Monday maintenance run')) {
        void this.runMaintenance(false);
      }
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
      if (this.policy('weeklySelfTest', 'the Monday push self-test')) {
        this.notify(
          'verified-done',
          'Weekly push self-test',
          'If you can read this on your device, push delivery is alive.',
        );
      }
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
  const devLaunchdLabel = `${LEGACY_RUNTIME_ANCHORS.launchdLabelPrefix}-dev`;
  const databasePath = path.join(getLegacyDataDirectory(), 'auth.db');
  return `You are the Monday self-maintenance run for the Command Center fork on the Mac mini. Work in ${repo}.
Append one line per finding to ~/forge-logs/monday-maintenance/JOURNAL.md as: HH:MM | item | classification | detail. Create the folder if missing.
${mode}
1. Upstream Command Center: ensure a git remote "upstream" exists pointing at https://github.com/siteboon/claudecodeui (add it if missing), git fetch upstream, and compare the upstream default branch against HEAD. Classify each new upstream commit as backend-safe (server-only, no frontend or build-surface changes), frontend-touching, or skip (release chores). Backend-safe commits: apply them, run npm run build and npm test, verify the dev instance boots healthy (launchctl kickstart -k gui/$(id -u)/${devLaunchdLabel} then curl http://127.0.0.1:4748/health), then promote with the "promote" CLI; every applied change gets a descriptive commit. Frontend-touching commits: never apply; send ONE decision-needed notification summarizing them via POST http://127.0.0.1:4747/api/watchdog/notify with header x-api-key read at runtime from ${databasePath} (sqlite3: SELECT api_key FROM api_keys WHERE is_active=1 LIMIT 1). Never print that key.
2. Claude Code CLI: compare the installed "claude --version" against the latest available version. If behind, read the release notes for the gap and assess impact on this fork (SDK behavior, flags the launchers pin, classifier or model changes) and on the planner/worker doctrine (~/Projects/spoton-worker/PLANNER.md, planner/reference/ including dispatch.md, and ~/.claude/commands/worker.md). Safe updates and doctrine touch-ups: apply silently with commits. Judgment-shaped changes (a breaking change, a new feature worth adopting, a doctrine rewrite): one decision-needed notification instead of silent edits.
3. A category with nothing to do gets a "nothing to do" journal line and NO notification. Total silence toward Willem is the correct outcome when everything is current.
Never push the scratch repo. Keep the final summary to a few lines.`;
}

/**
 * The /planner boot ritual as a plain prompt: a fresh rotated planner boots
 * through the same steps the slash command runs, grounding from STATE.md. The
 * body goes inline for every provider, which is also what a Codex planner
 * needs (Codex has no slash commands).
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
 * Rebuilds dispatch display metadata from phase prompt headers. This is the
 * watchdog-side equivalent of dispatch's fail-fast manifest compiler: names
 * and tasks are mandatory, explicit anchors win, and the standard
 * "Execute Job N of PUNCHLIST_x.md" identity supplies the task-count anchor.
 */
function manifestFromPhaseFiles(
  phaseFiles: string[],
): { entries: ChainManifestEntry[]; punchlist: string | null } | { error: string } {
  const entries: ChainManifestEntry[] = [];
  let punchlist: string | null = null;
  for (const phaseFile of phaseFiles) {
    let text: string;
    try {
      text = fs.readFileSync(phaseFile, 'utf8');
    } catch (error) {
      return { error: `Cannot read phase file ${phaseFile}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const metadata = new Map<string, string>();
    for (const match of text.slice(0, 4096).matchAll(/<!--\s*(name|tasks|anchor):\s*(.*?)\s*-->/gi)) {
      metadata.set(match[1].toLowerCase(), match[2].trim());
    }
    const name = metadata.get('name') ?? '';
    const tasks = (metadata.get('tasks') ?? '').split('|').map((task) => task.trim()).filter(Boolean);
    const missing = [...(!name ? ['name'] : []), ...(!tasks.length ? ['tasks'] : [])];
    if (missing.length) {
      return { error: `Phase file ${phaseFile} has no ${missing.join(' or ')}.` };
    }
    if (name.length > MANIFEST_NAME_MAX) {
      return { error: `Phase file ${phaseFile} has a name longer than ${MANIFEST_NAME_MAX} characters.` };
    }
    if (tasks.some((task) => task.length > MANIFEST_TASK_MAX)) {
      return { error: `Phase file ${phaseFile} has a task longer than ${MANIFEST_TASK_MAX} characters.` };
    }
    if ((metadata.get('anchor')?.length ?? 0) > MANIFEST_ANCHOR_MAX) {
      return { error: `Phase file ${phaseFile} has an anchor longer than ${MANIFEST_ANCHOR_MAX} characters.` };
    }

    const identity = /Execute\s+Job\s+(\d+)\s+of\s+([^\s`]+?\.md)\b/i.exec(text);
    const explicitAnchor = metadata.get('anchor');
    const anchor = explicitAnchor || (identity ? `Job ${identity[1]}` : undefined);
    if (identity) {
      const identityPunchlist = identity[2];
      if (punchlist && punchlist !== identityPunchlist) {
        return { error: `Phase file ${phaseFile} names ${identityPunchlist}, not chain punch list ${punchlist}.` };
      }
      punchlist = identityPunchlist;
    }
    entries.push({ name, tasks, kind: 'phase', ...(anchor ? { anchor } : {}) });
  }
  return { entries, punchlist };
}

/**
 * Normalizes an untrusted manifest value (DB JSON or request body) into clean
 * entries. Watchdog routes use strict mode to reject missing tasks or
 * overlong labels; service hydration uses tolerant mode for legacy rows.
 */
export function parseManifest(value: unknown, strict = false): ChainManifestEntry[] | null {
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
    if (!name || (strict && name.length > MANIFEST_NAME_MAX)) {
      if (strict) return null;
      continue;
    }
    const tasks = Array.isArray(entry?.tasks)
      ? entry.tasks.filter((task): task is string => typeof task === 'string' && task.trim() !== '').map((task) => task.trim())
      : [];
    const anchor = typeof entry?.anchor === 'string' && entry.anchor.trim() ? entry.anchor.trim() : undefined;
    if (strict && (!tasks.length || tasks.some((task) => task.length > MANIFEST_TASK_MAX)
      || (anchor?.length ?? 0) > MANIFEST_ANCHOR_MAX)) {
      return null;
    }
    entries.push({ name, tasks, kind: entry?.kind === 'task' ? 'task' : 'phase', ...(anchor ? { anchor } : {}) });
  }
  return entries.length ? entries : null;
}

/**
 * Normalizes an untrusted job-meta value (DB JSON or request body) into a
 * clean 1-based index → metadata map, dropping anything malformed. Watchdog
 * database hydration and focused persistence tests consume this boundary.
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
    if (Number.isInteger(Number(entry.taskDoneBaseline)) && Number(entry.taskDoneBaseline) >= 0) {
      meta.taskDoneBaseline = Number(entry.taskDoneBaseline);
    }
    if (typeof entry.failureReason === 'string' && entry.failureReason.trim()) {
      meta.failureReason = entry.failureReason.trim().slice(-2000);
    }
    if (entry.verify === 'running' || entry.verify === 'passed' || entry.verify === 'failed'
      || entry.verify === 'inconclusive' || entry.verify === 'stopped') {
      meta.verify = entry.verify;
    }
    if (typeof entry.verifyReason === 'string' && entry.verifyReason.trim()) {
      meta.verifyReason = entry.verifyReason.trim().slice(-2000);
    }
    if (Number.isFinite(Number(entry.verifyStartedAt))) {
      meta.verifyStartedAt = Number(entry.verifyStartedAt);
    }
    if (Number.isFinite(Number(entry.verifyEndedAt))) {
      meta.verifyEndedAt = Number(entry.verifyEndedAt);
    }
    if (typeof entry.verifySessionId === 'string' && entry.verifySessionId.trim()) {
      meta.verifySessionId = entry.verifySessionId.trim();
    }
    if (typeof entry.engine === 'string' && entry.engine.trim()) {
      meta.engine = entry.engine.trim();
    }
    if (typeof entry.model === 'string' && entry.model.trim()) {
      meta.model = entry.model.trim();
    }
    if (typeof entry.fastMode === 'boolean') {
      meta.fastMode = entry.fastMode;
    }
    if (entry.suite === 'green' || entry.suite === 'red') {
      meta.suite = entry.suite;
    }
    if (Array.isArray(entry.suiteFailures)) {
      meta.suiteFailures = entry.suiteFailures
        .filter((failure): failure is string => typeof failure === 'string' && failure.trim().length > 0)
        .map((failure) => failure.trim().slice(0, 500))
        .slice(0, 20);
    }
    if (Object.keys(meta).length) {
      jobs[index] = meta;
    }
  }
  return jobs;
}

/**
 * Prompt-derived punch-list location from the unit identity cache's stable
 * `PUNCHLIST_file.md#N` key. The filename pattern excludes path separators,
 * so resolving it under the registered project cannot escape that project.
 */
function promptPunchlistReference(
  identityKey: string | null,
  projectPath: string,
): { file: string; unitNumber: number } | null {
  const match = /^(PUNCHLIST_[\w.-]+\.md)#(\d+)$/.exec(identityKey ?? '');
  if (!match) {
    return null;
  }
  return { file: path.join(projectPath, match[1]), unitNumber: Number(match[2]) };
}

/**
 * Per-unit done counts from resolved punch-list sections (ui11 phase 6,
 * ui15 job 23): count checked boxes in either the manifest's explicit anchor
 * or the prompt-derived `Job N` / `Phase N` section. Returns null per entry
 * where the source or section is unavailable rather than inventing progress.
 */
function punchlistDoneCounts(
  manifest: ChainManifestEntry[] | null,
  sections: Array<PunchlistSection | null>,
): (number | null)[] | null {
  if (!manifest) {
    return null;
  }
  const files = new Map<string, string[] | null>();
  const readLines = (file: string): string[] | null => {
    if (files.has(file)) {
      return files.get(file) ?? null;
    }
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      files.set(file, lines);
      return lines;
    } catch {
      files.set(file, null);
      return null;
    }
  };
  return manifest.map((entry, index) => {
    const section = sections[index];
    if (!section) {
      return null;
    }
    const lines = readLines(section.file);
    if (!lines) {
      return null;
    }
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      const explicitMatch = section.anchor
        ? heading?.[2].toLowerCase().includes(section.anchor.toLowerCase())
        : false;
      const derivedMatch = section.unitNumber != null
        ? new RegExp(`^(?:Job|Phase)\\s+${section.unitNumber}(?:\\D|$)`, 'i').test(heading?.[2] ?? '')
        : false;
      if (heading && (explicitMatch || derivedMatch)) {
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
    // A planner may group several checklist boxes into one displayed task.
    // The UI's prefix count can never advance past the manifest task rows.
    return Math.min(done, entry.tasks.length);
  });
}

/**
 * The planner wake for a chain that reached a terminal state. Rebuilt from
 * the record (never stored) so hydrate can re-derive it after a restart.
 */
function terminalWakePrompt(chain: ChainRecord): string {
  const tail = chain.lastSummaryTail ? `\n\nFinal summary tail:\n${chain.lastSummaryTail}` : '';
  const verifySummary = countVerifyVerdicts(chain);
  const totals = `Verify totals: ${verifySummary.passed} passed, ${verifySummary.failed} failed, `
    + `${verifySummary.inconclusive} inconclusive.`;
  const failedVerifies = Object.entries(chain.jobs).filter(([, meta]) => meta.verify === 'failed');
  const inconclusiveVerifies = Object.entries(chain.jobs).filter(([, meta]) => meta.verify === 'inconclusive');
  if (chain.status === 'completed' && (failedVerifies.length > 0 || inconclusiveVerifies.length > 0)) {
    const failures = failedVerifies.map(([unit, meta]) => {
      const name = chain.manifest?.[Number(unit) - 1]?.name;
      const reason = meta.failureReason ?? 'The verifier reported a failure without a reason or resume point.';
      return `- Job ${unit}${name ? ` (${name})` : ''}${meta.commitHash ? ` at ${meta.commitHash}` : ''}: ${reason}`;
    }).join('\n');
    const inconclusives = inconclusiveVerifies.map(([unit, meta]) => {
      const name = chain.manifest?.[Number(unit) - 1]?.name;
      const reason = meta.verifyReason ?? 'The verifier supplied no reason.';
      return `- Job ${unit}${name ? ` (${name})` : ''}${meta.commitHash ? ` at ${meta.commitHash}` : ''}: ${reason}`;
    }).join('\n');
    const failureBlock = failures
      ? `\n\nFailed verifies need fix units from their recorded resume points:\n${failures}`
      : '';
    const inconclusiveBlock = inconclusives
      ? `\n\nInconclusive verifies were not passes and still need a conclusive check:\n${inconclusives}`
      : '';
    const outcome = inconclusiveVerifies.length === 0
      ? `completed with ${failedVerifies.length} verify ${failedVerifies.length === 1 ? 'failure' : 'failures'}`
      : `completed with ${failedVerifies.length} failed and ${inconclusiveVerifies.length} inconclusive verifies`;
    return `Watchdog: dispatched chain "${chain.slug}" ${outcome}. ${totals} Every build commit stayed on main.`
      + failureBlock + inconclusiveBlock + tail;
  }
  const flag = chain.status === 'completed'
    ? 'ended'
    : chain.status === 'stopped'
      ? 'STOPPED'
      : 'FAILED';
  return `Watchdog: dispatched chain "${chain.slug}" ${flag}${chain.phases ? ` (job ${chain.currentPhase ?? '?'} of ${chain.phases})` : ''}. `
    + `${totals} Verify the result against git log and the punch list before declaring anything done.${tail}`;
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

function countQueuedAppends(slug: string): number {
  try {
    return fs.readdirSync(path.join(chainJournalDir(slug), 'append'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

function appendChainJournalLine(slug: string, phase: string, event: string, detail: string): void {
  try {
    const directory = chainJournalDir(slug);
    fs.mkdirSync(directory, { recursive: true });
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} `
      + `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    fs.appendFileSync(path.join(directory, 'JOURNAL.md'), `${timestamp} | ${phase} | ${event} | ${detail}\n`);
  } catch (error) {
    log(`chain ${slug}: could not journal wake reroute: ${error instanceof Error ? error.message : String(error)}`);
  }
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
