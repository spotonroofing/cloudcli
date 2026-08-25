import { ChevronDown, Milestone } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { AgentDisclosure } from '../../shared/view/beui/AgentDisclosure';
import { SwapText } from '../../shared/view/beui/SwapText';
import { TodoStatusIcon, type TodoListItemStatus } from '../../shared/view/beui/TodoList';
import { EASE_OUT, SPRING_SWAP } from '../../shared/view/beui/ease';

/** One unit of a dispatch manifest: a compiled phase or an appended task. */
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
  /** 1-based unit index — matches the chain's phase numbering. */
  index: number;
  name: string;
  tasks: string[];
  kind: 'phase' | 'task';
  status: TodoListItemStatus;
  /** Punch-list done count; null hides the row counter (no manifest counts). */
  done: number | null;
};

function chainUnits(chain: ChainSnapshot): Unit[] {
  // A manifest-less chain still navigates: synthesize numbered phases from
  // the runner-reported count.
  const entries: ChainManifestEntry[] = chain.manifest
    ?? Array.from({ length: Math.max(chain.phases ?? 0, chain.currentPhase ?? 0, 1) }, (_, i) => ({
      name: `Phase ${i + 1}`,
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

type PhaseNavigatorProps = {
  /** The viewed run's chain; null for a free-standing (single-prompt) run. */
  chain: ChainSnapshot | null;
  /** Single-prompt fallback: the run itself renders as phase 1 of 1. */
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
};

/**
 * The worker pane's phase navigator (ui9 B4, reshaped in ui11 phase 10): the
 * primary status surface for a dispatched run. Collapsed shows "Phase N of M"
 * with counts; expanded lists every phase at once as collapsible task drawers
 * — the active phase's drawer opens by default, the others start collapsed,
 * all toggleable. Task rows carry check/working/idle status icons, the phase
 * row's ring advances with its done/total counter, and entries stagger in as
 * a manifest (or an append) lands.
 */
export default function PhaseNavigator({ chain, run }: PhaseNavigatorProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;

  const units: Unit[] = chain
    ? chainUnits(chain)
    : run
      ? [{ index: 1, name: run.label, tasks: [], kind: 'phase', status: runStateStatus[run.state], done: null }]
      : [];

  const running = chain ? chain.status === 'running' : run?.state === 'running';
  const phaseUnits = units.filter((unit) => unit.kind === 'phase');
  const phaseTotal = Math.max(phaseUnits.length, 1);
  const currentUnit = chain?.currentPhase ?? (units.length ? 1 : 0);
  const currentOrdinal = Math.max(
    units.slice(0, currentUnit).filter((unit) => unit.kind === 'phase').length,
    1,
  );
  const currentName = units[currentUnit - 1]?.name ?? units[0]?.name ?? '';
  const doneCount = units.filter((unit) => unit.status === 'completed').length;
  const allComplete = units.length > 0 && doneCount === units.length;

  const [open, setOpen] = useState(true);
  // Starts true so mounting on an already-finished run stays open (every run
  // defaults open); only a live transition into fully-complete collapses.
  const previousComplete = useRef(true);
  // Per-phase drawer overrides: unset rows follow the default (only the
  // active phase's drawer open), so advancing to the next phase opens its
  // drawer and lets the finished one fall closed without bookkeeping.
  const [drawerOverrides, setDrawerOverrides] = useState<Record<number, boolean>>({});
  // Every run defaults open: switching runs resets a user collapse instead of
  // carrying it over. Seeding previousComplete true keeps the auto-collapse
  // below from immediately re-collapsing an already-finished run.
  const runKey = chain?.slug ?? run?.label ?? '';
  const previousRunKey = useRef(runKey);
  useEffect(() => {
    if (previousRunKey.current !== runKey) {
      previousRunKey.current = runKey;
      previousComplete.current = true;
      setOpen(true);
      setDrawerOverrides({});
    }
  }, [runKey]);
  // Auto-collapse once the chain lands, TodoList-style; reopen if work grows.
  useEffect(() => {
    if (!previousComplete.current && allComplete) {
      setOpen(false);
    }
    if (previousComplete.current && !allComplete) {
      setOpen(true);
    }
    previousComplete.current = allComplete;
  }, [allComplete]);

  // Populate animation: rows past the previously rendered count are new (a
  // manifest landing or an append) and stagger in one by one; settled rows
  // never replay their entrance.
  const seenCountRef = useRef(0);
  const seenCount = seenCountRef.current;
  useEffect(() => {
    seenCountRef.current = units.length;
  }, [units.length]);

  if (!units.length) {
    return null;
  }

  return (
    <section
      aria-label="Run phases"
      data-slot="phase-navigator"
      data-state={chain?.status ?? run?.state}
      className="flex-shrink-0 border-b border-border/60 bg-muted/20"
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className="group flex h-9 w-full items-center gap-2 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          className={cn(
            'flex min-w-0 items-center gap-2',
            running && !reduce && 'animate-counter-breathe',
          )}
        >
          <Milestone className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="flex-shrink-0 text-xs font-medium tabular-nums text-foreground">
            Phase <SwapText value={String(currentOrdinal)}>{currentOrdinal}</SwapText> of{' '}
            <SwapText value={String(phaseTotal)}>{phaseTotal}</SwapText>
          </span>
          {currentName && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{currentName}</span>
          )}
        </span>
        <span className="min-w-0 flex-1" />
        <span
          data-slot="phase-navigator-counts"
          className={cn(
            'flex-shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground',
            allComplete && 'text-status-done',
          )}
        >
          <SwapText value={String(doneCount)}>{doneCount}</SwapText>
          <span>/</span>
          <span>{units.length}</span>
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="flex-shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} role="region" aria-labelledby={triggerId} open={open}>
        <ol className="max-h-56 overflow-y-auto px-2 pb-2">
          <AnimatePresence initial={false}>
            {units.map((unit, i) => {
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
                          delay: i >= seenCount ? (i - seenCount) * 0.07 : 0,
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
                    data-slot="phase-navigator-row"
                    data-phase={unit.index}
                    data-kind={unit.kind}
                    data-status={unit.status}
                    data-drawer={hasDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
                    className={cn(
                      'group/row flex w-full items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      unit.kind === 'task' ? 'min-h-7 pl-4' : 'min-h-8',
                      hasDrawer && 'cursor-pointer',
                      unit.status === 'in-progress' && !reduce && 'animate-counter-breathe',
                    )}
                  >
                    <span className={cn(unit.kind === 'task' && 'scale-90')}>
                      <TodoStatusIcon
                        status={unit.status}
                        // The phase ring advances with the counter; without
                        // counts the active ring stays indeterminate.
                        progress={
                          unit.status === 'in-progress' && unit.done != null && unit.tasks.length > 0
                            ? Math.min(100, (unit.done / unit.tasks.length) * 100)
                            : undefined
                        }
                      />
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
                        data-slot="phase-navigator-row-count"
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
                    <AgentDisclosure open={drawerOpen} data-slot="phase-navigator-drawer">
                      <ul className="pb-0.5 pl-9">
                        {unit.tasks.map((task, taskIndex) => {
                          const status = taskStatus(unit, taskIndex);
                          return (
                            <li
                              key={`${unit.index}-${taskIndex}`}
                              data-slot="phase-navigator-task"
                              data-status={status}
                              className={cn(
                                'flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
                                status === 'completed' && 'text-muted-foreground/45 line-through',
                                status === 'in-progress' && 'text-foreground',
                                status === 'pending' && 'text-muted-foreground/50',
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
      </AgentDisclosure>
    </section>
  );
}
