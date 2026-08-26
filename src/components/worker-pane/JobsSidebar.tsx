import { ChevronDown, Milestone, PanelRightClose } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { AgentDisclosure } from '../../shared/view/beui/AgentDisclosure';
import { SwapText } from '../../shared/view/beui/SwapText';
import { TodoStatusIcon, type TodoListItemStatus } from '../../shared/view/beui/TodoList';
import { EASE_OUT, SPRING_SWAP } from '../../shared/view/beui/ease';
import { Button, Tooltip } from '../../shared/view/ui';

/** One unit of a dispatch manifest: a compiled job or an appended task. */
export type ChainManifestEntry = {
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  /** Punch list heading anchor for this unit; server-side counting detail. */
  anchor?: string;
  /** Tasks checked off in the run's punch list; null when uncountable. */
  done?: number | null;
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
    return { index, name: entry.name, tasks: entry.tasks, kind: entry.kind, status, done: entry.done ?? null };
  });
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

type JobsSidebarProps = {
  /** The viewed run's chain; null for a free-standing (single-prompt) run. */
  chain: ChainSnapshot | null;
  /** Single-prompt fallback: the run itself renders as job 1 of 1. */
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
  /** Desktop only: collapses the sidebar into its rail. Omitted on the sheet. */
  onCollapse?: () => void;
  /**
   * Rail ring hand-off (ui13 job 1): mount with this job's drawer open and
   * its row scrolled into view. Read once at mount — the rail expand
   * remounts the sidebar.
   */
  focusJob?: number | null;
};

/**
 * The worker pane's jobs sidebar (ui12 phase 5, relocating the ui9 B4 phase
 * navigator): the primary status surface for a dispatched run, a right-hand
 * sidebar at the left sidebar's width. Every job lists as a collapsible task
 * drawer, ordered bottom-to-top — job 1 at the bottom, later jobs stacking
 * upward, the newest (or queued) on top — with the full history of a
 * completed run scrollable in place. Task rows carry check/working/idle
 * status icons, the job row's ring advances with its done/total counter, and
 * entries stagger in as a manifest (or an append) lands.
 */
export default function JobsSidebar({ chain, run, onCollapse, focusJob }: JobsSidebarProps) {
  const reduce = useReducedMotion() ?? false;

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
  // lets the finished one fall closed without bookkeeping. A rail ring click
  // seeds its job's drawer open (ui13 job 1).
  const [drawerOverrides, setDrawerOverrides] = useState<Record<number, boolean>>(
    () => (focusJob != null ? { [focusJob]: true } : {}),
  );
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusJob != null) {
      listRef.current?.querySelector(`[data-job="${focusJob}"]`)?.scrollIntoView({ block: 'center' });
    }
    // Mount-only: focusJob only changes across remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        {onCollapse && (
          <Tooltip content="Hide jobs sidebar" position="bottom">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 flex-shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={onCollapse}
              aria-label="Hide jobs sidebar"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
      </div>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence initial={false}>
          {stacked.map((unit) => {
            const hasDrawer = unit.tasks.length > 0;
            const drawerOpen = hasDrawer
              && (drawerOverrides[unit.index] ?? unit.index === currentUnit);
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
                <button
                  type="button"
                  disabled={!hasDrawer}
                  aria-expanded={hasDrawer ? drawerOpen : undefined}
                  onClick={() =>
                    setDrawerOverrides((previous) => ({ ...previous, [unit.index]: !drawerOpen }))
                  }
                  data-slot="jobs-sidebar-row"
                  data-job={unit.index}
                  data-kind={unit.kind}
                  data-status={unit.status}
                  data-drawer={hasDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
                  className={cn(
                    'group/row flex w-full items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    unit.kind === 'task' ? 'min-h-7 pl-4' : 'min-h-8',
                    hasDrawer && 'cursor-pointer',
                  )}
                >
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
                        // The job ring is a static circle segmented per task,
                        // filling as check-offs land; a job with no
                        // manifest tasks keeps the plain ramped spinner.
                        segments={
                          unit.status === 'in-progress' && unit.tasks.length > 0
                            ? { done: displayedDone(unit), total: unit.tasks.length }
                            : undefined
                        }
                      />
                    </span>
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate leading-5',
                      unit.kind === 'task' ? 'text-[12px]' : 'text-[13px]',
                      unit.status === 'pending' && 'text-muted-foreground/65',
                      unit.status === 'in-progress' && 'text-foreground',
                      unit.status === 'completed' && 'text-muted-foreground/60',
                      unit.status === 'cancelled' && 'text-muted-foreground/55',
                      hasDrawer && 'group-hover/row:text-foreground',
                    )}
                  >
                    {unit.name}
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
                  {hasDrawer && (
                    <motion.span
                      aria-hidden="true"
                      animate={{ rotate: drawerOpen ? 180 : 0 }}
                      transition={reduce ? { duration: 0 } : SPRING_SWAP}
                      className="flex-shrink-0 text-muted-foreground/50 transition-colors group-hover/row:text-muted-foreground"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </motion.span>
                  )}
                </button>
                {hasDrawer && (
                  <AgentDisclosure open={drawerOpen} data-slot="jobs-sidebar-drawer">
                    <ul className="pb-0.5 pl-9">
                      {unit.tasks.map((task, taskIndex) => {
                        const status = taskStatus(unit, taskIndex);
                        return (
                          <li
                            key={`${unit.index}-${taskIndex}`}
                            data-slot="jobs-sidebar-task"
                            data-status={status}
                            className={cn(
                              'flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
                              status === 'completed' && 'text-muted-foreground/45 line-through',
                              status === 'in-progress' && 'text-foreground',
                              status === 'pending' && 'text-muted-foreground/50',
                              // The working task row breathes (ui12 job 8).
                              status === 'in-progress' && !reduce && 'animate-row-breathe',
                            )}
                          >
                            <span className="flex-shrink-0 scale-[0.7]">
                              <TodoStatusIcon status={status} />
                            </span>
                            <span className="min-w-0 truncate">{task}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </AgentDisclosure>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

/**
 * Collapsed rail (ui13 job 1): a compact vertical list of the run's job
 * rings — one ring per job, its done/total count inside, statuses in the
 * monochromatic job treatment (solid ring done, ramped spinner working,
 * dashed idle). Same bottom-to-top order as the expanded list; clicking a
 * ring expands the sidebar with that job's drawer open.
 */
export function JobsRail({
  chain,
  run,
  onOpenJob,
}: {
  chain: ChainSnapshot | null;
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
  onOpenJob: (jobIndex: number) => void;
}) {
  const units: Unit[] = chain
    ? chainUnits(chain)
    : run
      ? [{ index: 1, name: run.label, tasks: [], kind: 'phase', status: runStateStatus[run.state], done: null }]
      : [];
  const stacked = [...units].reverse();

  return (
    <ol
      data-slot="jobs-rail"
      className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-1"
    >
      {stacked.map((unit) => {
        const done = displayedDone(unit);
        const total = unit.tasks.length;
        return (
          <li key={`${unit.index}-${unit.name}`}>
            <button
              type="button"
              onClick={() => onOpenJob(unit.index)}
              data-slot="jobs-rail-ring"
              data-job={unit.index}
              data-status={unit.status}
              aria-label={`Open ${unit.name}`}
              title={unit.name}
              className="relative grid h-9 w-9 place-items-center rounded-lg outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={cn(
                  'size-7 overflow-visible text-status-idle',
                  (unit.status === 'in-progress' || unit.status === 'completed') && 'text-foreground',
                  unit.status === 'cancelled' && 'text-rose-600 dark:text-rose-400',
                )}
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={unit.status === 'pending' ? '2 3' : undefined}
                  strokeLinecap="round"
                  className={cn(unit.status === 'in-progress' && 'opacity-20')}
                />
                {unit.status === 'in-progress' && (
                  <g
                    className="animate-spinner-ramp"
                    style={{ transformOrigin: '12px 12px', transform: 'rotate(-90deg)' }}
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      pathLength="1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray="0.68 0.32"
                    />
                  </g>
                )}
              </svg>
              {total > 0 && (
                <span
                  data-slot="jobs-rail-count"
                  className={cn(
                    'absolute text-[8px] font-medium leading-none tabular-nums',
                    done === total ? 'text-status-done' : 'text-muted-foreground',
                  )}
                >
                  {done}/{total}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
