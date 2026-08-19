import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import { providerRuntimeService } from '@/modules/providers/index.js';
import { sendFleetNotification } from '@/modules/notifications/index.js';
import { WS_OPEN_STATE, chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

type ChainStatus = 'running' | 'completed' | 'stopped' | 'failed';

type ChainRecord = {
  slug: string;
  projectPath: string;
  phases: number | null;
  currentPhase: number | null;
  status: ChainStatus;
  startedAt: number;
  lastEventAt: number;
  lastSummaryTail: string | null;
};

type DispatchRunRecord = {
  sessionId: string;
  projectPath: string;
  chainSlug: string | null;
  startedAt: number;
  lastEventAt: number;
  stuckWakeSent: boolean;
  ended: boolean;
};

type WakeQueue = {
  prompts: string[];
  draining: boolean;
};

const STUCK_SILENCE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const WAKE_RETRY_MS = 60 * 1000;
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
  private dispatchRuns = new Map<string, DispatchRunRecord>();
  private wakeQueues = new Map<string, WakeQueue>();
  private resourceAlertAt = new Map<string, number>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private selfTestTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.sweeper) {
      return;
    }
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
    this.scheduleWeeklySelfTest();
    log('started (sweep every 5m, weekly self-test scheduled)');
  }

  // ----- chain registry (populated by the dispatch CLI, spec B4) -----

  registerChain(input: { slug: string; projectPath: string; phases?: number | null }): void {
    this.chains.set(input.slug, {
      slug: input.slug,
      projectPath: input.projectPath,
      phases: input.phases ?? null,
      currentPhase: null,
      status: 'running',
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      lastSummaryTail: null,
    });
    log(`chain registered: ${input.slug}`, { projectPath: input.projectPath, phases: input.phases ?? null });
  }

  chainEvent(
    slug: string,
    event: 'phase-start' | 'phase-end' | 'completed' | 'stopped' | 'failed',
    detail?: { phase?: number; summaryTail?: string },
  ): boolean {
    const chain = this.chains.get(slug);
    if (!chain) {
      return false;
    }
    chain.lastEventAt = Date.now();
    if (typeof detail?.phase === 'number') {
      chain.currentPhase = detail.phase;
    }
    if (detail?.summaryTail) {
      chain.lastSummaryTail = detail.summaryTail.slice(-2000);
    }
    log(`chain ${slug}: ${event}`, { phase: chain.currentPhase, status: chain.status });

    if (event === 'completed' || event === 'stopped' || event === 'failed') {
      chain.status = event === 'completed' ? 'completed' : event === 'stopped' ? 'stopped' : 'failed';
      const flag = chain.status === 'completed'
        ? 'ended'
        : chain.status === 'stopped'
          ? 'STOPPED AT THE COMMIT GATE'
          : 'FAILED';
      const tail = chain.lastSummaryTail ? `\n\nFinal summary tail:\n${chain.lastSummaryTail}` : '';
      this.queueWake(
        chain.projectPath,
        `Watchdog: dispatched chain "${slug}" ${flag}${chain.phases ? ` (phase ${chain.currentPhase ?? '?'} of ${chain.phases})` : ''}. `
        + `Verify the result against git log and the punch list before declaring anything done.${tail}`,
      );
    }
    return true;
  }

  // ----- dispatched single runs (external run surface) -----

  runStarted(sessionId: string, projectPath: string, chainSlug: string | null): void {
    this.dispatchRuns.set(sessionId, {
      sessionId,
      projectPath,
      chainSlug,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      stuckWakeSent: false,
      ended: false,
    });
  }

  runActivity(sessionId: string): void {
    const run = this.dispatchRuns.get(sessionId);
    if (run) {
      run.lastEventAt = Date.now();
    }
  }

  runEnded(sessionId: string, projectPath: string, chainSlug: string | null): void {
    const run = this.dispatchRuns.get(sessionId);
    if (run) {
      run.ended = true;
      run.lastEventAt = Date.now();
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

  queueWake(projectPath: string, prompt: string): void {
    const queue = this.wakeQueues.get(projectPath) ?? { prompts: [], draining: false };
    queue.prompts.push(prompt);
    this.wakeQueues.set(projectPath, queue);
    log(`wake queued for ${projectPath} (${queue.prompts.length} pending)`);
    void this.drainWakes(projectPath);
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
          log(`no planner session found for ${projectPath}; dropping ${queue.prompts.length} wake(s)`);
          queue.prompts.length = 0;
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

        const prompt = queue.prompts[0];
        log(`waking planner ${planner.session_id} for ${projectPath}`);
        try {
          // Resume by provider-native id, but only when a transcript actually
          // exists on disk; otherwise boot a fresh planner session — the
          // planner is stateless by design and re-grounds from STATE.md.
          const resumeId = planner.jsonl_path ? planner.provider_session_id : null;
          const result = await this.runPlannerTurn(resumeId, planner.model, projectPath, prompt);
          if (result.errored && resumeId && /no conversation found/i.test(result.errorMessage ?? '')) {
            log(`planner session ${planner.session_id} is dead; booting a fresh planner`);
            const fresh = await this.runPlannerTurn(null, planner.model, projectPath, prompt);
            if (fresh.errored) {
              throw new Error(fresh.errorMessage ?? 'fresh planner boot failed');
            }
          } else if (result.errored) {
            throw new Error(result.errorMessage ?? 'wake run failed');
          }
          queue.prompts.shift();
          log(`wake delivered to planner for ${projectPath} (${queue.prompts.length} left)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
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
  ): Promise<{ errored: boolean; errorMessage: string | null }> {
    const runner = providerRuntimeService.getRunner('claude');
    let announcedId: string | null = providerSessionId;
    let errorMessage: string | null = null;
    const writer = {
      // The provider runtime reports SDK failures as error events instead of
      // throwing; capture them so the queue can retry or fall back.
      send: (data: unknown) => {
        const event = data as { type?: string; error?: unknown; message?: unknown } | null;
        if (event && event.type === 'error') {
          errorMessage = String(event.error ?? event.message ?? 'unknown error');
        }
      },
      setSessionId: (id: string) => {
        announcedId = id;
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
    return { errored: errorMessage !== null, errorMessage };
  }

  // ----- periodic sweep: stuck runs + machine resources -----

  private async sweep(): Promise<void> {
    const now = Date.now();

    for (const run of this.dispatchRuns.values()) {
      if (run.ended || run.stuckWakeSent) {
        continue;
      }
      if (now - run.lastEventAt > STUCK_SILENCE_MS) {
        run.stuckWakeSent = true;
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
      }
    }

    await this.checkResources(now);
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
