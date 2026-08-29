import { Bolt, ChevronDown, Clock3, Cpu, GitCommitHorizontal, Hash, MessageSquare, Pause } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { AgentDisclosure } from '../../shared/view/beui/AgentDisclosure';
import { MarqueeLabel } from '../../shared/view/beui/MarqueeLabel';
import { TodoStatusIcon, type TodoListItemStatus } from '../../shared/view/beui/TodoList';
import { EASE_OUT, SPRING_SWAP } from '../../shared/view/beui/ease';
import { Button, Skeleton, Tooltip } from '../../shared/view/ui';
import { useSharedNow } from '../../hooks/useSharedNow';

/** Side-column width: exactly 20px over ui14 below the 260px cap. */
export const JOBS_COLUMN_BASIS = 'min(16.25rem, calc(33.333cqw + 1.25rem))';
/** One replace-in-place history page; the long tail never stays mounted. */
export const JOBS_HISTORY_PAGE_SIZE = 40;

/** One unit of a dispatch manifest: a compiled job or an appended task. */
export type ChainManifestEntry = {
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  /** Punch list heading anchor for this unit; server-side counting detail. */
  anchor?: string;
  /** Tasks checked off in the run's punch list; null when uncountable. */
  done?: number | null;
  /** Job boundaries, commit, and task check-off times (ui13 job 14); absent
   *  where the watchdog never observed them (historical runs). */
  startedAt?: number;
  endedAt?: number;
  commitHash?: string;
  commitSubject?: string;
  taskTimes?: (number | null)[];
  /** Runner detail captured when this job failed or stopped. */
  failureReason?: string;
  /** Verify stage (ui14 job 10): the runner's fresh-context verifier ran
   *  against the job's commit; absent where the runner never verified. */
  verify?: 'running' | 'passed' | 'failed' | 'stopped';
  verifyStartedAt?: number;
  verifyEndedAt?: number;
  verifySessionId?: string;
  /** The build stage's engine and model (codex job 2), from the runner's announce. */
  engine?: string;
  model?: string;
  /** True when this build unit launched with service_tier=fast. */
  fastMode?: boolean;
  /** A twin of another chain's unit (codex job 5): hidden from the list, row kept. */
  hidden?: boolean;
  supersededBy?: string;
};

/** The watchdog's live chain snapshot (worker-runs response / chain_progress). */
export type ChainSnapshot = {
  slug: string;
  projectPath: string;
  status: 'running' | 'paused' | 'completed' | 'stopped' | 'failed';
  phases: number | null;
  currentPhase: number | null;
  phaseActive: boolean;
  /** Chain preference read by the runner at the next Codex build boundary. */
  fastMode?: boolean;
  /** Failed verifier verdicts recorded while the chain continues. */
  verifyFailures?: number;
  manifest: ChainManifestEntry[] | null;
  startedAt: number;
  lastEventAt: number;
};

type Unit = {
  /** List-wide identity: `slug:index` for chain units, `run:<id>` for chain-less runs. */
  key: string;
  /** The chain this unit belongs to; null for a chain-less run. */
  chainSlug: string | null;
  /** 1-based unit index — matches the chain's internal phase numbering. */
  index: number;
  /** The unit's session, when one exists to navigate to. */
  sessionId?: string;
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  status: TodoListItemStatus;
  /** True for the current job of a paused chain. */
  paused?: boolean;
  /** Punch-list done count; null hides the row counter (no manifest counts). */
  done: number | null;
  /** Commit and timing metadata for the drawer footer (ui13 job 14). */
  startedAt?: number;
  endedAt?: number;
  commitHash?: string;
  commitSubject?: string;
  taskTimes?: (number | null)[];
  failureReason?: string;
  /** Verify stage state for the drawer's verify row (ui14 job 10). */
  verify?: 'running' | 'passed' | 'failed' | 'stopped';
  verifyStartedAt?: number;
  verifyEndedAt?: number;
  verifySessionId?: string;
  /** Engine and model the unit ran on (codex job 2). */
  engine?: string;
  model?: string;
  /** This historical unit launched on the fast Codex service tier. */
  fastMode?: boolean;
  /** Whole build-session spend, fresh input plus output (ui17 job 19). */
  tokenCount?: number | null;
  /** Context re-read from cache across the build session; shown apart, never summed in. */
  cacheReadCount?: number | null;
  /** A landed verify failure repaired by this named superseding unit. */
  verifyFixedIn?: string;
  /** The build landed, but its terminal chain never launched this verifier. */
  verifyNeverRan?: boolean;
};

type RepairTruth = {
  fixedFailures: ReadonlyMap<string, string>;
  repairWinners: ReadonlySet<string>;
};

const unitKey = (slug: string, index: number): string => `${slug}:${index}`;
const unitRefKey = (reference: string): string => reference.replace(/\/(\d+)$/, ':$1');

function baseUnitStatus(chain: ChainSnapshot, entry: ChainManifestEntry, index: number): TodoListItemStatus {
  const current = chain.currentPhase ?? 0;
  if (entry.verify === 'failed') return 'cancelled';
  if (entry.commitHash) return 'completed';
  if (chain.status === 'completed' || index < current) return 'completed';
  if (index === current) return chain.status === 'running' ? 'in-progress' : 'cancelled';
  return 'pending';
}

/**
 * A committed build whose failed verifier was repaired by a landed
 * superseding unit stays as the one logical row. The server's twin metadata
 * already names that repair, so no punch-list-specific exception is needed.
 */
function repairedFailureTruth(groups: JobGroup[]): RepairTruth {
  const entries = new Map<string, { chain: ChainSnapshot; entry: ChainManifestEntry; index: number }>();
  for (const group of groups) {
    group.chain?.manifest?.forEach((entry, entryIndex) => {
      const index = entryIndex + 1;
      entries.set(unitKey(group.chain!.slug, index), { chain: group.chain!, entry, index });
    });
  }

  const candidatesByWinner = new Map<string, { key: string; startedAt: number }[]>();
  for (const [key, value] of entries) {
    const { chain, entry } = value;
    if (!entry.hidden || !entry.supersededBy || !entry.commitHash || entry.verify !== 'failed') continue;
    const winnerKey = unitRefKey(entry.supersededBy);
    const winner = entries.get(winnerKey);
    if (!winner || winner.entry.hidden || winner.entry.verify === 'failed' || winner.entry.verify === 'stopped') continue;
    if (baseUnitStatus(winner.chain, winner.entry, winner.index) !== 'completed') continue;
    const candidates = candidatesByWinner.get(winnerKey) ?? [];
    candidates.push({ key, startedAt: chain.startedAt });
    candidatesByWinner.set(winnerKey, candidates);
  }

  const fixedFailures = new Map<string, string>();
  const repairWinners = new Set<string>();
  for (const [winnerKey, candidates] of candidatesByWinner) {
    const repaired = [...candidates].sort((a, b) => a.startedAt - b.startedAt)[0];
    const winner = entries.get(winnerKey);
    if (!repaired || !winner) continue;
    fixedFailures.set(repaired.key, winner.entry.name);
    repairWinners.add(winnerKey);
  }
  return { fixedFailures, repairWinners };
}

function chainUnits(chain: ChainSnapshot, repairTruth: RepairTruth): Unit[] {
  // A manifest-less chain still lists: synthesize numbered jobs from the
  // runner-reported count.
  const entries: ChainManifestEntry[] = chain.manifest
    ?? Array.from({ length: Math.max(chain.phases ?? 0, chain.currentPhase ?? 0, 1) }, (_, i) => ({
      name: `Job ${i + 1}`,
      tasks: [],
      kind: 'phase' as const,
    }));
  const current = chain.currentPhase ?? 0;
  // Twins the watchdog marked hidden (codex job 5) leave the list here, so
  // the column, the full-pane view and every drawer read one filtered list;
  // the index keeps the chain's own numbering.
  return entries.flatMap((entry, i) => {
    const index = i + 1;
    const key = unitKey(chain.slug, index);
    const verifyFixedIn = repairTruth.fixedFailures.get(key);
    if ((entry.hidden && !verifyFixedIn) || repairTruth.repairWinners.has(key)) {
      return [];
    }
    // A landed superseding unit resolves the old verifier failure on the one
    // logical row; the quiet fixed-in note preserves the history.
    const status: TodoListItemStatus = verifyFixedIn ? 'completed' : baseUnitStatus(chain, entry, index);
    const paused = chain.status === 'paused' && index === current;
    return [{
      key,
      chainSlug: chain.slug,
      index,
      name: entry.name,
      tasks: entry.tasks,
      kind: entry.kind,
      status,
      paused,
      done: entry.done ?? null,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      commitHash: entry.commitHash,
      commitSubject: entry.commitSubject,
      taskTimes: entry.taskTimes,
      failureReason: entry.failureReason,
      verify: verifyFixedIn ? undefined : entry.verify,
      verifyStartedAt: entry.verifyStartedAt,
      verifyEndedAt: entry.verifyEndedAt,
      verifySessionId: entry.verifySessionId,
      engine: entry.engine,
      model: entry.model,
      fastMode: entry.fastMode,
      verifyFixedIn,
      verifyNeverRan: Boolean(
        entry.commitHash
        && !entry.verify
        && index === current
        && (chain.status === 'stopped' || chain.status === 'failed')
      ),
    }];
  });
}

/** The footer's "1m 50s" duration format; hour-long jobs read "1h 4m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Exact token total with lining separators; the narrow row may shrink it. */
function formatTokenCount(tokens: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(tokens);
}

/** Cache reads run to tens of millions, so the quiet figure stays short. */
function formatCacheReads(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}k`;
  return String(tokens);
}

/**
 * Compact date for jobs older than 24 hours (ui14 job 12), e.g. "Aug 25" —
 * owner-facing, so rendered in America/New_York regardless of host timezone.
 */
function formatJobDate(endedAt: number): string | null {
  if (Date.now() - endedAt < 24 * 60 * 60 * 1000) {
    return null;
  }
  return new Date(endedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * A completed task's duration from the watchdog's check-off times (ui13 job
 * 14): task i runs from the previous check-off (job start for the first) to
 * its own. Null where the data genuinely does not exist — historical runs, or
 * check-offs the watchdog only observed after the fact.
 */
function taskDurationMs(unit: Unit, taskIndex: number): number | null {
  const end = unit.taskTimes?.[taskIndex];
  if (end == null) {
    return null;
  }
  const start = taskIndex === 0 ? unit.startedAt : unit.taskTimes?.[taskIndex - 1];
  if (start == null) {
    return null;
  }
  return end - start;
}

/** Live elapsed counter for a running job's footer: ticks from its start event. */
function LiveElapsed({ startedAt }: { startedAt: number }) {
  const now = useSharedNow(true, 1000);
  return <>{formatDuration(now - startedAt)}</>;
}

/**
 * Commit metadata on a job's drawer: what the job shipped, kept separate
 * from the total-time row so the drawer's reading order stays deterministic.
 */
function JobCommitRow({ unit }: { unit: Unit }) {
  if (!unit.commitHash) {
    return null;
  }
  return (
    <li
      data-slot="jobs-sidebar-job-commit"
      data-commit={unit.commitHash}
      data-marquee-hover
      className="flex min-h-5 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/60"
    >
      <GitCommitHorizontal className="h-3 w-3 flex-shrink-0 scale-[0.9]" aria-hidden="true" />
      <span className="flex-shrink-0 font-mono text-[10px] tabular-nums">{unit.commitHash}</span>
      <div className="min-w-0 flex-1 overflow-hidden [&>.relative]:max-w-full">
        <Tooltip content={unit.commitSubject} position="top">
          <MarqueeLabel active={false} activateOnParentHover className="min-w-0 max-w-full">
            {unit.commitSubject ?? ''}
          </MarqueeLabel>
        </Tooltip>
      </div>
    </li>
  );
}

/**
 * Drawer-bottom token figures beside the live or fixed total time. The first
 * figure is what the unit spent (fresh input plus output); cache reads sit
 * beside it as their own quieter number and are never added in (ui17 job 19) -
 * summing them turned 133k of real output into a 12 million runaway.
 */
function JobTotalRow({ unit }: { unit: Unit }) {
  const running = unit.status === 'in-progress' && unit.endedAt == null;
  const hasTime = unit.startedAt != null && (running || unit.endedAt != null);
  if (!hasTime && unit.tokenCount == null) {
    return null;
  }
  const duration = unit.endedAt != null && unit.startedAt != null ? unit.endedAt - unit.startedAt : null;
  const date = unit.endedAt != null ? formatJobDate(unit.endedAt) : null;
  return (
    <li
      data-slot="jobs-sidebar-job-total"
      data-live={running ? 'true' : undefined}
      className="flex min-h-5 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/60"
    >
      {hasTime ? (
        <Clock3 className="h-3 w-3 flex-shrink-0 scale-[0.9]" aria-hidden="true" />
      ) : (
        <Hash className="h-3 w-3 flex-shrink-0 scale-[0.9]" aria-hidden="true" />
      )}
      <span>{hasTime ? 'Total' : 'Tokens'}</span>
      <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2 font-mono text-[10px] tabular-nums text-muted-foreground/50">
        {unit.tokenCount != null && (
          <span data-slot="jobs-sidebar-token-total" data-token-count={unit.tokenCount}>
            {formatTokenCount(unit.tokenCount)}
          </span>
        )}
        {unit.cacheReadCount != null && unit.cacheReadCount > 0 && (
          <span
            data-slot="jobs-sidebar-cache-reads"
            data-cache-read-count={unit.cacheReadCount}
            className="text-muted-foreground/40"
          >
            {formatCacheReads(unit.cacheReadCount)} cached
          </span>
        )}
        {hasTime && (
          <span>
            {date && (
              <span data-slot="jobs-sidebar-job-date" className="pr-1.5">
                {date}
              </span>
            )}
            {running ? <LiveElapsed startedAt={unit.startedAt!} /> : formatDuration(duration!)}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Engine row on a job's drawer (codex job 2), before the commit footer: the
 * engine and model the unit's build ran on, in the footer's meta style.
 * Absent until the runner announces the unit's session.
 */
function EngineRow({ unit }: { unit: Unit }) {
  if (!unit.engine) {
    return null;
  }
  return (
    <li
      data-slot="jobs-sidebar-job-engine"
      data-engine={unit.engine}
      data-model={unit.model}
      className="flex min-h-5 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/60"
    >
      <Cpu className="h-3 w-3 flex-shrink-0 scale-[0.9]" aria-hidden="true" />
      <span className="min-w-0 truncate">{unit.engine}</span>
      {unit.model && (
        <span className="ml-auto flex-shrink-0 pl-2 font-mono text-[10px] text-muted-foreground/50">{unit.model}</span>
      )}
    </li>
  );
}

/**
 * The verifier's task-style row sits directly below the build tasks. It
 * ticks while live, then settles to its terminal label and measured time.
 */
function VerifyRow({ unit, onOpenSession }: { unit: Unit; onOpenSession: (sessionId: string) => void }) {
  if (!unit.verify) {
    return null;
  }
  const sessionId = unit.verifySessionId;
  const running = unit.verify === 'running';
  const status: TodoListItemStatus = running
    ? 'in-progress'
    : unit.verify === 'passed'
      ? 'completed'
      : 'cancelled';
  const label = running
    ? `Verifying ${unit.name}`
    : unit.verify === 'passed'
      ? 'Verified'
      : unit.verify === 'failed'
        ? 'Verify failed'
        : 'Verify stopped';
  const duration = unit.verifyStartedAt != null && unit.verifyEndedAt != null
    ? unit.verifyEndedAt - unit.verifyStartedAt
    : null;
  return (
    <li
      data-slot="jobs-sidebar-verify"
      data-status={status}
      data-live={running ? 'true' : undefined}
      onClick={sessionId ? () => onOpenSession(sessionId) : undefined}
      className={cn(
        'flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
        running ? 'text-foreground' : 'text-muted-foreground/60',
        status === 'cancelled' && 'text-rose-600 dark:text-rose-400',
        sessionId && 'cursor-pointer hover:text-foreground',
      )}
    >
      <span className="flex-shrink-0 scale-[0.7]">
        <TodoStatusIcon status={status} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto flex-shrink-0 pl-2 font-mono text-[10px] tabular-nums text-muted-foreground/45">
        {running && unit.verifyStartedAt != null
          ? <LiveElapsed startedAt={unit.verifyStartedAt} />
          : duration != null ? formatDuration(duration) : null}
      </span>
    </li>
  );
}

/** Failure detail at the foot of a failed/stopped job drawer, kept to one line. */
function FailureReason({ unit }: { unit: Unit }) {
  if (unit.status !== 'cancelled') return null;
  // A repaired verifier failure without a stored reason is already explained
  // by its fixed-in note; do not mislabel it as a stopped build.
  if (unit.verifyFixedIn && !unit.failureReason) return null;
  const reason = (unit.failureReason ?? 'Job stopped before completion.').replace(/\s+/g, ' ').trim();
  return (
    <li
      data-slot="jobs-sidebar-failure-reason"
      className="min-h-5 truncate text-[11px] leading-4 text-rose-600 dark:text-rose-400"
    >
      {reason}
    </li>
  );
}

/** Repair truth for a landed job, kept to one quiet line in the drawer. */
function VerifyFixedNote({ unit }: { unit: Unit }) {
  if (!unit.verifyFixedIn) return null;
  return (
    <li
      data-slot="jobs-sidebar-verify-fixed"
      className="min-h-5 truncate text-[11px] leading-4 text-muted-foreground/60"
    >
      Verify fixed in {unit.verifyFixedIn}
    </li>
  );
}

/** A landed build is done even when its dead chain never launched verify. */
function VerifyNeverRanNote({ unit }: { unit: Unit }) {
  if (!unit.verifyNeverRan) return null;
  return (
    <li
      data-slot="jobs-sidebar-verify-never-ran"
      className="min-h-5 truncate text-[11px] leading-4 text-muted-foreground/60"
    >
      Verify never ran, chain ended
    </li>
  );
}

/**
 * Displayed done count (ui12 phase 4): the punch-list count when the server
 * could read one, else derived from unit status — a finished uncountable
 * unit reads all done, anything else zero. Real planner dispatches carry no
 * punch-list anchors, so the server count is null for them; deriving here is
 * what makes counters render for any chain with a manifest.
 */
function displayedDone(unit: Unit): number {
  return unit.done ?? (unit.status === 'completed' ? unit.tasks.length : 0);
}

/**
 * Per-task status icons (ui11 phase 10): the punch list checks off in order,
 * so the done count maps onto the task list as a prefix — the first `done`
 * tasks read done, the next task of the active unit reads working, the rest
 * idle. A finished unit checks everything; a cancelled one freezes at done.
 */
function taskStatus(unit: Unit, taskIndex: number): TodoListItemStatus {
  // Honesty over tidiness: a finished unit with countable check-offs shows
  // its unchecked tasks idle, not silently checked. Only an uncountable
  // finished unit assumes all done.
  const done = displayedDone(unit);
  if (taskIndex < done) {
    return 'completed';
  }
  if (unit.status === 'cancelled' && unit.done != null && taskIndex === done) {
    return 'cancelled';
  }
  if (taskIndex === done && unit.status === 'in-progress') {
    return 'in-progress';
  }
  return 'pending';
}


const runStateStatus: Record<'running' | 'finished' | 'stopped', TodoListItemStatus> = {
  running: 'in-progress',
  finished: 'completed',
  stopped: 'cancelled',
};

/**
 * One run of the project in the jobs list (ui14 job 1): a dispatch chain with
 * its units, or a chain-less run that renders as a single job row.
 */
export type JobGroup = {
  chain: ChainSnapshot | null;
  /** Chain-less run: label and state for its one row. */
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
  /** Unit index → session id, for the units that have a session to open. */
  sessions: Record<number, string>;
  /** Unit index → provider-source whole-session spend. */
  tokenCounts?: Record<number, number | null>;
  /** Unit index → provider-source whole-session cache reads. */
  cacheReadCounts?: Record<number, number | null>;
  /** Ordering key: newer groups sit higher in the list. */
  startedAt: number;
};

/** A unit with its bottom-to-top position in the flat list (1 = oldest). */
type PositionedUnit = Unit & { position: number; historyStartedAt: number };

type HistoryPeriod = { year: string; month: string; monthKey: string; monthLabel: string };

function historyPeriod(startedAt: number): HistoryPeriod {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).formatToParts(new Date(startedAt));
  const year = parts.find((part) => part.type === 'year')?.value ?? 'Unknown';
  const month = parts.find((part) => part.type === 'month')?.value ?? 'Unknown';
  return { year, month, monthKey: `${year}-${month}`, monthLabel: month };
}

type JobsSidebarProps = {
  /** Every run of the project, newest first. */
  groups: JobGroup[];
  /** The first worker-runs snapshot is still in flight. */
  loading?: boolean;
  /** The session the pane is showing; marks its row. */
  activeSessionId: string | null;
  /** Navigate the worker pane to a unit's session. */
  onOpenSession: (sessionId: string) => void;
  /** Flip the running chain's next-unit Codex service tier. */
  onToggleFastMode?: (slug: string, enabled: boolean) => void;
  /** Slug whose route write is still in flight. */
  fastModePendingSlug?: string | null;
  /** Slug showing the first-arm next-job hint. */
  fastModeHintSlug?: string | null;
};

type ChainFastModeToggleProps = {
  chain: ChainSnapshot;
  pending?: boolean;
  showHint?: boolean;
  onToggle: (slug: string, enabled: boolean) => void;
};

/** Shared by the jobs chain header and worker pane header to keep one bolt language. */
export function ChainFastModeToggle({ chain, pending = false, showHint = false, onToggle }: ChainFastModeToggleProps) {
  const label = chain.fastMode ? 'Turn off fast mode' : 'Run next Codex job fast';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {showHint && chain.fastMode && (
        <span data-slot="chain-fast-mode-hint" className="truncate text-[10px] text-muted-foreground">
          next job runs fast
        </span>
      )}
      <Tooltip content={label} position="bottom">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot="chain-fast-mode-toggle"
          data-chain={chain.slug}
          data-fast-mode={chain.fastMode ? 'on' : 'off'}
          aria-label={label}
          aria-pressed={chain.fastMode}
          disabled={pending}
          onClick={() => onToggle(chain.slug, !chain.fastMode)}
          className={cn(
            'touch-hit relative h-6 w-6 p-0 hover:text-foreground',
            chain.fastMode ? 'bg-accent/60 text-foreground' : 'text-muted-foreground',
          )}
        >
          <Bolt className={cn('h-3.5 w-3.5', chain.fastMode && 'fill-current')} />
        </Button>
      </Tooltip>
    </span>
  );
}

/**
 * The jobs list (ui12 phase 5 sidebar; a side column or full-pane view since
 * ui14 job 1): the primary status surface for the project's dispatched runs,
 * toggled by the worker top bar's job sign. One chronological history across
 * every run of the project, ordered newest first and paged in replace-in-place
 * windows so its long tail does not remain in the DOM. Every job is a
 * collapsible task drawer; task rows carry check/working/idle status icons,
 * the job row's ring advances with its done/total counter, and entries
 * stagger in as a manifest (or an append) lands.
 */
function JobsSidebar({
  groups,
  loading = false,
  activeSessionId,
  onOpenSession,
  onToggleFastMode,
  fastModePendingSlug = null,
  fastModeHintSlug = null,
}: JobsSidebarProps) {
  const reduce = useReducedMotion() ?? false;
  const repairTruth = repairedFailureTruth(groups);
  const runningChain = groups.find((group) =>
    group.chain?.status === 'running' || group.chain?.status === 'paused')?.chain ?? null;

  // Newest group first, each group's newest unit first — the flat list is
  // already top-to-bottom; positions count from the bottom for the stagger.
  const stacked: PositionedUnit[] = [];
  for (const group of groups) {
    const units: Unit[] = group.chain
      ? chainUnits(group.chain, repairTruth)
      : group.run
        ? [{
            key: `run:${group.sessions[1] ?? group.run.label}`,
            chainSlug: null,
            index: 1,
            name: group.run.label,
            tasks: [],
            kind: 'phase',
            status: runStateStatus[group.run.state],
            done: null,
          }]
        : [];
    for (const unit of [...units].reverse()) {
      stacked.push({
        ...unit,
        sessionId: group.sessions[unit.index],
        tokenCount: group.tokenCounts?.[unit.index] ?? null,
        cacheReadCount: group.cacheReadCounts?.[unit.index] ?? null,
        historyStartedAt: unit.startedAt ?? group.startedAt,
        position: 0,
      });
    }
  }
  stacked.forEach((unit, i) => {
    unit.position = stacked.length - i;
  });

  // Per-job drawer overrides: unset rows follow the default (only the newest
  // run's current job open), so advancing to the next job opens its drawer
  // and lets the finished one fall closed without bookkeeping.
  const newest = groups[0] ?? null;
  const defaultOpenKey = newest?.chain
    ? `${newest.chain.slug}:${newest.chain.currentPhase ?? 1}`
    : null;
  const [drawerOverrides, setDrawerOverrides] = useState<Record<string, boolean>>({});
  const [tappedTask, setTappedTask] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  const historyPageCount = Math.max(1, Math.ceil(stacked.length / JOBS_HISTORY_PAGE_SIZE));
  const activeUnitIndex = activeSessionId
    ? stacked.findIndex((unit) => unit.sessionId === activeSessionId)
    : -1;
  const pageStart = historyPage * JOBS_HISTORY_PAGE_SIZE;
  const visibleStacked = stacked.slice(pageStart, pageStart + JOBS_HISTORY_PAGE_SIZE);

  useEffect(() => {
    setHistoryPage((page) => Math.min(page, historyPageCount - 1));
  }, [historyPageCount]);

  useEffect(() => {
    if (activeUnitIndex < 0) return;
    setHistoryPage(Math.floor(activeUnitIndex / JOBS_HISTORY_PAGE_SIZE));
  }, [activeSessionId, activeUnitIndex]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [historyPage]);

  // Populate animation: units past the previously rendered count are new (a
  // manifest landing or an append) and stagger in one by one; settled rows
  // never replay their entrance.
  const seenCountRef = useRef(0);
  const seenCount = seenCountRef.current;
  useEffect(() => {
    seenCountRef.current = stacked.length;
  }, [stacked.length]);

  const periods = stacked.map((unit) => historyPeriod(unit.historyStartedAt));
  const monthDoneCounts = new Map<string, number>();
  const yearDoneCounts = new Map<string, number>();
  stacked.forEach((unit, index) => {
    if (unit.status !== 'completed') return;
    const period = periods[index];
    monthDoneCounts.set(period.monthKey, (monthDoneCounts.get(period.monthKey) ?? 0) + 1);
    yearDoneCounts.set(period.year, (yearDoneCounts.get(period.year) ?? 0) + 1);
  });

  return (
    <section
      aria-label="Jobs"
      data-slot="jobs-sidebar"
      data-history-total={stacked.length}
      className="flex h-full min-w-0 flex-col bg-muted/20"
    >
      {runningChain && onToggleFastMode && (
        <div
          data-slot="jobs-chain-header"
          data-chain={runningChain.slug}
          data-verify-failures={runningChain.verifyFailures ?? 0}
          className="flex min-h-8 items-center gap-2 border-b border-border/50 px-2 text-[11px] text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">{runningChain.slug}</span>
          {(runningChain.verifyFailures ?? 0) > 0 && (
            <span
              data-slot="jobs-chain-verify-failures"
              className="flex-shrink-0 tabular-nums text-rose-600 dark:text-rose-400"
            >
              {runningChain.verifyFailures} verify {runningChain.verifyFailures === 1 ? 'failure' : 'failures'}
            </span>
          )}
          <ChainFastModeToggle
            chain={runningChain}
            pending={fastModePendingSlug === runningChain.slug}
            showHint={fastModeHintSlug === runningChain.slug}
            onToggle={onToggleFastMode}
          />
        </div>
      )}
      {loading && groups.length === 0 ? (
        <div
          className="min-h-0 flex-1 space-y-2 overflow-hidden px-2 py-2"
          data-slot="jobs-sidebar-skeleton"
          aria-busy="true"
        >
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex min-h-8 items-center gap-2 px-1.5">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton
                className="h-3 rounded-sm"
                style={{ width: `${[72, 56, 80, 64, 48, 68][row]}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence initial={false}>
          {visibleStacked.map((unit, pageIndex) => {
            const unitIndex = pageStart + pageIndex;
            const hasDrawer = unit.tasks.length > 0
              || unit.tokenCount != null
              || unit.engine != null
              || unit.commitHash != null
              || unit.status === 'cancelled'
              || unit.verify != null
              || unit.verifyFixedIn != null;
            const drawerOpen = hasDrawer
              && (drawerOverrides[unit.key] ?? unit.key === defaultOpenKey);
            // Disclosure owns the row and title. Navigation is deliberately
            // isolated to the explicit chat affordance in the trailing slot.
            const navigable = Boolean(unit.sessionId);
            const open = () => {
              if (unit.sessionId) {
                onOpenSession(unit.sessionId);
              }
            };
            const active = unit.sessionId != null && unit.sessionId === activeSessionId;
            const toggleDrawer = () =>
              setDrawerOverrides((previous) => ({ ...previous, [unit.key]: !drawerOpen }));
            const titleClasses = cn(
              'flex max-w-full min-w-0 text-left leading-5',
              'text-[13px]',
              unit.status === 'pending' && 'text-muted-foreground/65',
              unit.status === 'in-progress' && 'text-foreground',
              unit.status === 'completed' && 'text-muted-foreground/60',
              unit.status === 'cancelled' && 'text-muted-foreground/55',
              unit.paused && 'text-foreground',
              hasDrawer && 'group-hover/row:text-foreground',
            );
            const period = periods[unitIndex];
            const previousPeriod = unitIndex > 0 ? periods[unitIndex - 1] : null;
            const crossedYear = previousPeriod != null && previousPeriod.year !== period.year;
            const crossedMonth = previousPeriod != null && previousPeriod.monthKey !== period.monthKey;
            return (
              <React.Fragment key={unit.key}>
              {crossedYear && (
                <li
                  data-slot="jobs-sidebar-year-group"
                  data-period={period.year}
                  className="mt-2 flex min-h-6 items-center border-t border-border/50 px-1.5 pt-1.5 text-[11px] font-medium text-foreground"
                >
                  <span>{period.year}</span>
                  <span className="ml-auto text-[10px] font-normal tabular-nums text-muted-foreground">
                    {yearDoneCounts.get(period.year) ?? 0} done
                  </span>
                </li>
              )}
              {crossedMonth && (
                <li
                  data-slot="jobs-sidebar-month-group"
                  data-period={period.monthKey}
                  className="mt-1 flex min-h-6 items-center px-1.5 text-[11px] font-medium text-muted-foreground"
                >
                  <span>{period.monthLabel}</span>
                  <span className="ml-auto text-[10px] font-normal tabular-nums text-muted-foreground/70">
                    {monthDoneCounts.get(period.monthKey) ?? 0} done
                  </span>
                </li>
              )}
              <motion.li
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        duration: 0.22,
                        ease: EASE_OUT,
                        delay: unit.position > seenCount ? (unit.position - seenCount - 1) * 0.07 : 0,
                      }
                }
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 32px' }}
              >
                <div
                  onClick={hasDrawer ? toggleDrawer : undefined}
                  data-slot="jobs-sidebar-row"
                  data-job={unit.index}
                  data-chain={unit.chainSlug ?? undefined}
                  data-kind={unit.kind}
                  data-status={unit.paused ? 'paused' : unit.status}
                  data-drawer={hasDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
                  data-active={active ? 'true' : undefined}
                  data-marquee-hover
                  className={cn(
                    'group/row relative flex w-full items-center gap-2 rounded-md px-1.5 text-left',
                    'min-h-8',
                    hasDrawer && 'cursor-pointer',
                    (hasDrawer || navigable) && 'hover:bg-accent/50',
                  )}
                >
                  {/* Active-session indicator (ui13 job 2): a quiet
                      foreground-ink edge bar, monochromatic, no chip. */}
                  {active && (
                    <span
                      aria-hidden="true"
                      data-slot="jobs-sidebar-active-bar"
                      className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-foreground/70"
                    />
                  )}
                  <span>
                    {/* The active job's indicator breathes (ui12 job 8);
                        the pulse wraps only the icon, not the row. */}
                    <span
                      className={cn(
                        'block',
                        unit.status === 'in-progress' && !reduce && 'animate-row-breathe',
                      )}
                    >
                      {unit.paused ? (
                        <span
                          data-slot="jobs-sidebar-paused-icon"
                          aria-label="Paused"
                          className="flex h-4 w-4 items-center justify-center rounded-full border border-foreground/70 text-foreground"
                        >
                          <Pause className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                        </span>
                      ) : (
                        <TodoStatusIcon
                          status={unit.status}
                          sweepOnComplete={unit.verify !== 'running'}
                          centerSpinner={unit.verify === 'running' && Boolean(unit.commitHash)}
                          // Jobs mono, tasks semantic (ui13 job 1): the job
                          // row's check and ring render in the foreground ink;
                          // green stays on task icons and the counters.
                          tone="mono"
                          compactTerminalMarks
                          fullFailureRing
                          // The job ring is a static circle segmented per task
                          // from the start (ui13 job 7): idle jobs show the
                          // same ring muted and motionless; the active job's
                          // fills as check-offs land, its working segment
                          // glowing. A manifest-less job keeps a plain circle
                          // (ramped spinner while working).
                          segments={unit.tasks.length > 0
                            ? {
                                done: unit.status === 'completed' || unit.verify === 'running'
                                  ? unit.tasks.length
                                  : displayedDone(unit),
                                total: unit.tasks.length,
                              }
                            : undefined}
                        />
                      )}
                    </span>
                  </span>
                  {/* The title and its freed middle space both disclose. */}
                  <span className="min-w-0 flex-1">
                    {hasDrawer ? (
                      <button
                        type="button"
                        aria-expanded={drawerOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleDrawer();
                        }}
                        data-slot="jobs-sidebar-row-title"
                        className={cn(
                          titleClasses,
                          'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        <MarqueeLabel
                          active={false}
                          activateOnParentHover
                          startDelay={0.18}
                          stopImmediately
                          className="flex-initial"
                        >
                          {unit.name}
                        </MarqueeLabel>
                      </button>
                    ) : (
                      <span className={titleClasses}>
                        <MarqueeLabel
                          active={false}
                          activateOnParentHover
                          startDelay={0.18}
                          stopImmediately
                          className="flex-initial"
                        >
                          {unit.name}
                        </MarqueeLabel>
                      </span>
                    )}
                  </span>
                  {unit.fastMode && (
                    <Bolt
                      aria-label="Ran fast"
                      data-slot="jobs-sidebar-fast-unit"
                      className="h-3 w-3 flex-shrink-0 fill-current text-muted-foreground/60"
                    />
                  )}
                  {/* Trailing slot: navigable rows swap the chevron for a
                      chat icon on hover (ui13 job 2); rows without a session
                      keep the plain state chevron. */}
                  {navigable ? (
                    <button
                      type="button"
                      aria-label={`Open ${unit.name} chat`}
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                      data-slot="jobs-sidebar-row-chat"
                      className="flex-shrink-0 rounded-sm text-muted-foreground/50 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring group-hover/row:text-muted-foreground"
                    >
                      {hasDrawer && (
                        <motion.span
                          aria-hidden="true"
                          animate={{ rotate: drawerOpen ? 180 : 0 }}
                          transition={reduce ? { duration: 0 } : SPRING_SWAP}
                          className="block group-hover/row:hidden"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </motion.span>
                      )}
                      <MessageSquare
                        className={cn(
                          'h-3.5 w-3.5',
                          hasDrawer
                            ? 'hidden group-hover/row:block'
                            : 'invisible group-hover/row:visible',
                        )}
                      />
                    </button>
                  ) : hasDrawer ? (
                    <motion.span
                      aria-hidden="true"
                      animate={{ rotate: drawerOpen ? 180 : 0 }}
                      transition={reduce ? { duration: 0 } : SPRING_SWAP}
                      className="flex-shrink-0 text-muted-foreground/50 transition-colors group-hover/row:text-muted-foreground"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </motion.span>
                  ) : null}
                </div>
                {hasDrawer && drawerOpen && (
                  <AgentDisclosure open={drawerOpen} data-slot="jobs-sidebar-drawer">
                    <ul className="pb-0.5 pl-5">
                      {unit.tasks.map((task, taskIndex) => {
                        const status = taskStatus(unit, taskIndex);
                        const taskKey = `${unit.key}-${taskIndex}`;
                        const reveal = tappedTask === taskKey;
                        // Per-task duration (ui13 job 14): completed tasks
                        // only, and only where the timing honestly exists.
                        const duration = status === 'completed' ? taskDurationMs(unit, taskIndex) : null;
                        return (
                          <li
                            key={taskKey}
                            data-slot="jobs-sidebar-task"
                            data-status={status}
                            data-reveal={reveal ? 'true' : undefined}
                            data-marquee-hover
                            onPointerUp={(event) => {
                              if (event.pointerType !== 'mouse') {
                                setTappedTask((current) => (current === taskKey ? null : taskKey));
                              }
                            }}
                            className={cn(
                              'group/task flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
                              status === 'completed' && 'text-muted-foreground/45',
                              status === 'in-progress' && 'text-foreground',
                              status === 'pending' && 'text-muted-foreground/50',
                              status === 'cancelled' && 'text-rose-600 dark:text-rose-400',
                              reveal && status !== 'cancelled' && 'text-foreground',
                              status !== 'cancelled' && 'hover:text-foreground',
                              // The working task row breathes (ui12 job 8).
                              status === 'in-progress' && !reduce && 'animate-row-breathe',
                            )}
                          >
                            <span className="flex-shrink-0 scale-[0.7]">
                              <TodoStatusIcon status={status} />
                            </span>
                            {/* Hover/tap reveals the fixed task time, restores
                                the text, and scans an overflowing label once
                                through and back on the shared ramped marquee. */}
                            <MarqueeLabel
                              active={reveal}
                              activateOnParentHover
                              mode="once"
                              startDelay={0.18}
                              stopImmediately
                              className={cn(status === 'completed' && !reveal && 'line-through group-hover/task:no-underline')}
                            >
                              {task}
                            </MarqueeLabel>
                            {duration != null ? (
                              <span
                                data-slot="jobs-sidebar-task-duration"
                                className={cn(
                                  'ml-auto flex-shrink-0 pl-2 font-mono text-[10px] tabular-nums text-muted-foreground/45 transition-opacity',
                                  reveal ? 'opacity-100' : 'opacity-0 group-hover/task:opacity-100',
                                )}
                              >
                                {formatDuration(duration)}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                      <VerifyRow unit={unit} onOpenSession={onOpenSession} />
                      <VerifyFixedNote unit={unit} />
                      <VerifyNeverRanNote unit={unit} />
                      <FailureReason unit={unit} />
                      <EngineRow unit={unit} />
                      <JobCommitRow unit={unit} />
                      <JobTotalRow unit={unit} />
                    </ul>
                  </AgentDisclosure>
                )}
              </motion.li>
              </React.Fragment>
            );
          })}
        </AnimatePresence>
      </ol>
      )}
      {!loading && stacked.length > JOBS_HISTORY_PAGE_SIZE && (
        <nav
          aria-label="Jobs history pages"
          data-slot="jobs-history-pages"
          className="flex min-h-8 items-center justify-between border-t border-border/50 px-2 text-[11px] text-muted-foreground"
        >
          <button
            type="button"
            data-slot="jobs-history-newer"
            disabled={historyPage === 0}
            onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}
            className="rounded-sm px-1.5 py-1 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
          >
            Newer
          </button>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
            {historyPage + 1} / {historyPageCount}
          </span>
          <button
            type="button"
            data-slot="jobs-history-older"
            disabled={historyPage >= historyPageCount - 1}
            onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))}
            className="rounded-sm px-1.5 py-1 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
          >
            Older
          </button>
        </nav>
      )}
    </section>
  );
}

JobsSidebar.displayName = 'JobsSidebar';

export default React.memo(JobsSidebar);
