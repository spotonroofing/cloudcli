import { ChevronDown, GitCommitHorizontal, MessageSquare, Milestone } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { AgentDisclosure } from '../../shared/view/beui/AgentDisclosure';
import { MarqueeLabel } from '../../shared/view/beui/MarqueeLabel';
import { SwapText } from '../../shared/view/beui/SwapText';
import { TodoStatusIcon, type TodoListItemStatus } from '../../shared/view/beui/TodoList';
import { EASE_OUT, SPRING_SWAP } from '../../shared/view/beui/ease';

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
};

/** The watchdog's live chain snapshot (worker-runs response / chain_progress). */
export type ChainSnapshot = {
  slug: string;
  projectPath: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  phases: number | null;
  currentPhase: number | null;
  phaseActive: boolean;
  manifest: ChainManifestEntry[] | null;
  startedAt: number;
  lastEventAt: number;
};

type Unit = {
  /** 1-based unit index — matches the chain's internal phase numbering. */
  index: number;
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  status: TodoListItemStatus;
  /** Punch-list done count; null hides the row counter (no manifest counts). */
  done: number | null;
  /** Commit and timing metadata for the drawer footer (ui13 job 14). */
  startedAt?: number;
  endedAt?: number;
  commitHash?: string;
  commitSubject?: string;
  taskTimes?: (number | null)[];
};

function chainUnits(chain: ChainSnapshot): Unit[] {
  // A manifest-less chain still lists: synthesize numbered jobs from the
  // runner-reported count.
  const entries: ChainManifestEntry[] = chain.manifest
    ?? Array.from({ length: Math.max(chain.phases ?? 0, chain.currentPhase ?? 0, 1) }, (_, i) => ({
      name: `Job ${i + 1}`,
      tasks: [],
      kind: 'phase' as const,
    }));
  const current = chain.currentPhase ?? 0;
  return entries.map((entry, i) => {
    const index = i + 1;
    let status: TodoListItemStatus = 'pending';
    if (chain.status === 'completed' || index < current) {
      status = 'completed';
    } else if (index === current) {
      status = chain.status === 'running' ? 'in-progress' : 'cancelled';
    }
    return {
      index,
      name: entry.name,
      tasks: entry.tasks,
      kind: entry.kind,
      status,
      done: entry.done ?? null,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      commitHash: entry.commitHash,
      commitSubject: entry.commitSubject,
      taskTimes: entry.taskTimes,
    };
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(now - startedAt)}</>;
}

/**
 * Commit footer on a job's drawer (ui13 job 14), directly after its last task
 * row: what the job shipped — short hash + commit subject (marquee when long)
 * — with the job's total duration right-aligned in the tasks' meta style, all
 * monochromatic. A running job shows the footer with a live elapsed counter
 * that settles into the final duration at completion; idle jobs show none.
 */
function JobFooter({ unit }: { unit: Unit }) {
  const [hovered, setHovered] = useState(false);
  // A just-ended job reads in-progress until the next phase starts; endedAt
  // is what settles the ticking counter into the final duration.
  const running = unit.status === 'in-progress';
  const showCommit = Boolean(unit.commitHash);
  const showElapsed = running && unit.startedAt != null && unit.endedAt == null;
  if (!showCommit && !showElapsed) {
    return null;
  }
  const duration = unit.startedAt != null && unit.endedAt != null ? unit.endedAt - unit.startedAt : null;
  return (
    <li
      data-slot="jobs-sidebar-job-footer"
      data-live={showElapsed ? 'true' : undefined}
      data-commit={unit.commitHash}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex min-h-5 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/60"
    >
      <GitCommitHorizontal className="h-3 w-3 flex-shrink-0 scale-[0.9]" aria-hidden="true" />
      {showCommit && (
        <>
          <span className="flex-shrink-0 font-mono text-[10px] tabular-nums">{unit.commitHash}</span>
          <MarqueeLabel active={hovered} className="flex-1">
            {unit.commitSubject ?? ''}
          </MarqueeLabel>
        </>
      )}
      <span className="ml-auto flex-shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/50">
        {showElapsed ? <LiveElapsed startedAt={unit.startedAt!} /> : duration != null ? formatDuration(duration) : null}
      </span>
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
 * The chain's job ordinal and job count for the worker top bar's jobs-count
 * control (ui13 job 10); a chain-less run reads as job 1 of 1.
 */
export function jobProgress(chain: ChainSnapshot | null): { ordinal: number; total: number } {
  if (!chain) {
    return { ordinal: 1, total: 1 };
  }
  const units = chainUnits(chain);
  const total = Math.max(units.filter((unit) => unit.kind === 'phase').length, 1);
  const current = chain.currentPhase ?? (units.length ? 1 : 0);
  const ordinal = Math.max(
    units.slice(0, current).filter((unit) => unit.kind === 'phase').length,
    1,
  );
  return { ordinal, total };
}

type JobsSidebarProps = {
  /** The viewed run's chain; null for a free-standing (single-prompt) run. */
  chain: ChainSnapshot | null;
  /** Single-prompt fallback: the run itself renders as job 1 of 1. */
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
  /** The unit whose session the pane is showing (ui13 job 2). */
  activeJob?: number | null;
  /** Units with a session to navigate to (chain phases that have runs). */
  openableJobs?: number[];
  /** Navigate the worker pane to this unit's session. */
  onOpenJob?: (jobIndex: number) => void;
  /**
   * The project's runs outside the shown chain — the retired run-switcher
   * dropdown's cross-run jump, relocated here (ui13 job 2).
   */
  otherRuns?: { sessionId: string; label: string; age: string | null }[];
  onSelectRun?: (sessionId: string) => void;
};

/**
 * The full-pane jobs view (ui12 phase 5 sidebar, a switcher view since ui13
 * job 10): the primary status surface for a dispatched run, swapped in place
 * of the worker transcript behind the top bar's jobs count. Every job lists
 * as a collapsible task drawer, ordered bottom-to-top — job 1 at the bottom,
 * later jobs stacking upward, the newest (or queued) on top — with the full
 * history of a completed run scrollable in place. Task rows carry
 * check/working/idle status icons, the job row's ring advances with its
 * done/total counter, and entries stagger in as a manifest (or an append)
 * lands.
 */
export default function JobsSidebar({
  chain,
  run,
  activeJob,
  openableJobs,
  onOpenJob,
  otherRuns,
  onSelectRun,
}: JobsSidebarProps) {
  const reduce = useReducedMotion() ?? false;
  const openable = new Set(openableJobs ?? []);

  const units: Unit[] = chain
    ? chainUnits(chain)
    : run
      ? [{ index: 1, name: run.label, tasks: [], kind: 'phase', status: runStateStatus[run.state], done: null }]
      : [];

  const running = chain ? chain.status === 'running' : run?.state === 'running';
  const jobUnits = units.filter((unit) => unit.kind === 'phase');
  const jobTotal = Math.max(jobUnits.length, 1);
  const currentUnit = chain?.currentPhase ?? (units.length ? 1 : 0);
  const currentOrdinal = Math.max(
    units.slice(0, currentUnit).filter((unit) => unit.kind === 'phase').length,
    1,
  );
  const doneCount = units.filter((unit) => unit.status === 'completed').length;
  const allComplete = units.length > 0 && doneCount === units.length;

  // Per-job drawer overrides: unset rows follow the default (only the active
  // job's drawer open), so advancing to the next job opens its drawer and
  // lets the finished one fall closed without bookkeeping.
  const [drawerOverrides, setDrawerOverrides] = useState<Record<number, boolean>>({});
  // Hover marquee on job rows (ui13 job 3): mouse enter/leave is effectively
  // fine-pointer only — touch taps act before hover matters.
  const [hoveredJob, setHoveredJob] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Switching runs resets any user drawer toggles instead of carrying them over.
  const runKey = chain?.slug ?? run?.label ?? '';
  const previousRunKey = useRef(runKey);
  useEffect(() => {
    if (previousRunKey.current !== runKey) {
      previousRunKey.current = runKey;
      setDrawerOverrides({});
    }
  }, [runKey]);

  // Populate animation: units past the previously rendered count are new (a
  // manifest landing or an append) and stagger in one by one; settled rows
  // never replay their entrance.
  const seenCountRef = useRef(0);
  const seenCount = seenCountRef.current;
  useEffect(() => {
    seenCountRef.current = units.length;
  }, [units.length]);

  // Bottom-to-top: job 1 sits at the bottom, the newest unit renders first.
  const stacked = [...units].reverse();

  return (
    <section
      aria-label="Run jobs"
      data-slot="jobs-sidebar"
      data-state={chain?.status ?? run?.state}
      className="flex h-full min-w-0 flex-col bg-muted/20"
    >
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span
          className={cn(
            'flex min-w-0 items-center gap-2',
            running && !reduce && 'animate-counter-breathe',
          )}
        >
          <Milestone className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="flex-shrink-0 text-xs font-medium tabular-nums text-foreground">
            Job <SwapText value={String(currentOrdinal)}>{currentOrdinal}</SwapText> of{' '}
            <SwapText value={String(jobTotal)}>{jobTotal}</SwapText>
          </span>
        </span>
        <span className="min-w-0 flex-1" />
        <span
          data-slot="jobs-sidebar-counts"
          className={cn(
            'flex-shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground',
            allComplete && 'text-status-done',
          )}
        >
          <SwapText value={String(doneCount)}>{doneCount}</SwapText>
          <span>/</span>
          <span>{units.length}</span>
        </span>
      </div>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence initial={false}>
          {stacked.map((unit) => {
            const hasDrawer = unit.tasks.length > 0;
            const drawerOpen = hasDrawer
              && (drawerOverrides[unit.index] ?? unit.index === currentUnit);
            // Jobs are the navigation (ui13 job 2): a unit with a session
            // navigates the pane on row click; the title alone toggles the
            // drawer. Units without sessions keep the whole-row toggle.
            const navigable = Boolean(onOpenJob && openable.has(unit.index));
            const toggleDrawer = () =>
              setDrawerOverrides((previous) => ({ ...previous, [unit.index]: !drawerOpen }));
            const titleClasses = cn(
              'flex max-w-full min-w-0 text-left leading-5',
              unit.kind === 'task' ? 'text-[12px]' : 'text-[13px]',
              unit.status === 'pending' && 'text-muted-foreground/65',
              unit.status === 'in-progress' && 'text-foreground',
              unit.status === 'completed' && 'text-muted-foreground/60',
              unit.status === 'cancelled' && 'text-muted-foreground/55',
              (hasDrawer || navigable) && 'group-hover/row:text-foreground',
            );
            return (
              <motion.li
                key={`${unit.index}-${unit.name}`}
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        duration: 0.22,
                        ease: EASE_OUT,
                        delay: unit.index > seenCount ? (unit.index - seenCount - 1) * 0.07 : 0,
                      }
                }
              >
                <div
                  onClick={
                    navigable
                      ? () => onOpenJob?.(unit.index)
                      : hasDrawer
                        ? toggleDrawer
                        : undefined
                  }
                  data-slot="jobs-sidebar-row"
                  data-job={unit.index}
                  data-kind={unit.kind}
                  data-status={unit.status}
                  data-drawer={hasDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
                  data-active={unit.index === activeJob ? 'true' : undefined}
                  onMouseEnter={() => setHoveredJob(unit.index)}
                  onMouseLeave={() => setHoveredJob((current) => (current === unit.index ? null : current))}
                  className={cn(
                    'group/row relative flex w-full items-center gap-2 rounded-md px-1.5 text-left',
                    unit.kind === 'task' ? 'min-h-7 pl-4' : 'min-h-8',
                    (hasDrawer || navigable) && 'cursor-pointer',
                    navigable && 'hover:bg-accent/50',
                  )}
                >
                  {/* Active-session indicator (ui13 job 2): a quiet
                      foreground-ink edge bar, monochromatic, no chip. */}
                  {unit.index === activeJob && (
                    <span
                      aria-hidden="true"
                      data-slot="jobs-sidebar-active-bar"
                      className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-foreground/70"
                    />
                  )}
                  <span className={cn(unit.kind === 'task' && 'scale-90')}>
                    {/* The active job's indicator breathes (ui12 job 8);
                        the pulse wraps only the icon, not the row. */}
                    <span
                      className={cn(
                        'block',
                        unit.status === 'in-progress' && !reduce && 'animate-row-breathe',
                      )}
                    >
                      <TodoStatusIcon
                        status={unit.status}
                        sweepOnComplete
                        // Jobs mono, tasks semantic (ui13 job 1): the job
                        // row's check and ring render in the foreground ink;
                        // green stays on task icons and the counters.
                        tone="mono"
                        // The job ring is a static circle segmented per task
                        // from the start (ui13 job 7): idle jobs show the
                        // same ring muted and motionless; the active job's
                        // fills as check-offs land, its working segment
                        // glowing. A manifest-less job keeps a plain circle
                        // (ramped spinner while working).
                        segments={
                          (unit.status === 'in-progress' || unit.status === 'pending')
                          && unit.tasks.length > 0
                            ? { done: displayedDone(unit), total: unit.tasks.length }
                            : undefined
                        }
                      />
                    </span>
                  </span>
                  {/* The title shrinks to its text: the leftover middle
                      space stays row body, so it navigates, not toggles. */}
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
                        <MarqueeLabel active={hoveredJob === unit.index} className="flex-initial">
                          {unit.name}
                        </MarqueeLabel>
                      </button>
                    ) : (
                      <span className={titleClasses}>
                        <MarqueeLabel active={hoveredJob === unit.index} className="flex-initial">
                          {unit.name}
                        </MarqueeLabel>
                      </span>
                    )}
                  </span>
                  {unit.tasks.length > 0 && (
                    <span
                      data-slot="jobs-sidebar-row-count"
                      className={cn(
                        'flex-shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground',
                        displayedDone(unit) === unit.tasks.length && 'text-status-done',
                      )}
                    >
                      <SwapText value={String(displayedDone(unit))}>{displayedDone(unit)}</SwapText>
                      <span>/</span>
                      <span>{unit.tasks.length}</span>
                    </span>
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
                        onOpenJob?.(unit.index);
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
                {hasDrawer && (
                  <AgentDisclosure open={drawerOpen} data-slot="jobs-sidebar-drawer">
                    <ul className="pb-0.5 pl-9">
                      {unit.tasks.map((task, taskIndex) => {
                        const status = taskStatus(unit, taskIndex);
                        // Per-task duration (ui13 job 14): completed tasks
                        // only, and only where the timing honestly exists.
                        const duration = status === 'completed' ? taskDurationMs(unit, taskIndex) : null;
                        return (
                          <li
                            key={`${unit.index}-${taskIndex}`}
                            data-slot="jobs-sidebar-task"
                            data-status={status}
                            className={cn(
                              'flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
                              status === 'completed' && 'text-muted-foreground/45',
                              status === 'in-progress' && 'text-foreground',
                              status === 'pending' && 'text-muted-foreground/50',
                              // The working task row breathes (ui12 job 8).
                              status === 'in-progress' && !reduce && 'animate-row-breathe',
                            )}
                          >
                            <span className="flex-shrink-0 scale-[0.7]">
                              <TodoStatusIcon status={status} />
                            </span>
                            {/* Strike the task text only — the trailing
                                duration meta stays unstruck. */}
                            <span className={cn('min-w-0 truncate', status === 'completed' && 'line-through')}>
                              {task}
                            </span>
                            {duration != null && (
                              <span
                                data-slot="jobs-sidebar-task-duration"
                                className="ml-auto flex-shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/45"
                              >
                                {formatDuration(duration)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                      <JobFooter unit={unit} />
                    </ul>
                  </AgentDisclosure>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      {/* Other runs (ui13 job 2): the project's runs outside the shown chain
          — the retired run-switcher dropdown's cross-run jump lives here. */}
      {onSelectRun && otherRuns && otherRuns.length > 0 && (
        <div
          data-slot="jobs-sidebar-other-runs"
          className="max-h-44 flex-shrink-0 overflow-y-auto border-t border-border/60 px-2 py-2"
        >
          <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Other runs
          </p>
          <ul>
            {otherRuns.map((other) => (
              <li key={other.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelectRun(other.sessionId)}
                  data-slot="jobs-sidebar-other-run"
                  data-session-id={other.sessionId}
                  className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <MessageSquare className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                    {other.label}
                  </span>
                  {other.age && (
                    <span className="flex-shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground/70">
                      {other.age}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

