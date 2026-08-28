import { ChevronDown, Cpu, GitCommitHorizontal, MessageSquare, Pause } from 'lucide-react';
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
  /** Verify stage (ui14 job 10): the runner's fresh-context verifier ran
   *  against the job's commit; absent where the runner never verified. */
  verify?: 'running' | 'passed' | 'failed' | 'stopped';
  verifyStartedAt?: number;
  verifyEndedAt?: number;
  verifySessionId?: string;
  /** The build stage's engine and model (codex job 2), from the runner's announce. */
  engine?: string;
  model?: string;
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
  /** Verify stage state for the drawer's verify row (ui14 job 10). */
  verify?: 'running' | 'passed' | 'failed' | 'stopped';
  verifyStartedAt?: number;
  verifyEndedAt?: number;
  verifySessionId?: string;
  /** Engine and model the unit ran on (codex job 2). */
  engine?: string;
  model?: string;
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
  // Twins the watchdog marked hidden (codex job 5) leave the list here, so
  // the column, the full-pane view and every drawer read one filtered list;
  // the index keeps the chain's own numbering.
  return entries.flatMap((entry, i) => {
    if (entry.hidden) {
      return [];
    }
    const index = i + 1;
    let status: TodoListItemStatus = 'pending';
    const paused = chain.status === 'paused' && index === current;
    if (chain.status === 'completed' || index < current) {
      status = 'completed';
    } else if (index === current) {
      status = chain.status === 'running' ? 'in-progress' : 'cancelled';
    }
    return [{
      key: `${chain.slug}:${index}`,
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
      verify: entry.verify,
      verifyStartedAt: entry.verifyStartedAt,
      verifyEndedAt: entry.verifyEndedAt,
      verifySessionId: entry.verifySessionId,
      engine: entry.engine,
      model: entry.model,
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
        {/* Day-old jobs carry their date next to the duration (ui14 job 12). */}
        {!showElapsed && unit.endedAt != null && formatJobDate(unit.endedAt) && (
          <span data-slot="jobs-sidebar-job-date" className="pr-1.5">
            {formatJobDate(unit.endedAt)}
          </span>
        )}
        {showElapsed ? <LiveElapsed startedAt={unit.startedAt!} /> : duration != null ? formatDuration(duration) : null}
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

type VerifyState = 'running' | 'passed' | 'failed' | 'stopped';

const verifyRowStatus: Record<VerifyState, TodoListItemStatus> = {
  running: 'in-progress',
  passed: 'completed',
  failed: 'cancelled',
  stopped: 'cancelled',
};

const verifyRowLabel: Record<VerifyState, string> = {
  running: 'Verifying',
  passed: 'Verified',
  failed: 'Verify failed',
  stopped: 'Verify stopped',
};

/**
 * Verify row on a job's drawer (ui14 job 10), after the commit footer: the
 * runner's fresh-context verify stage, which runs against the job's commit
 * while the next job builds. Task-style status icon (working ring, check,
 * X on failure), the stage label, and its duration right-aligned in the meta
 * style (live while running). Clicking opens the verifier's session when
 * one exists. Absent on jobs the runner never verified.
 */
function VerifyRow({ unit, onOpenSession }: { unit: Unit; onOpenSession: (sessionId: string) => void }) {
  if (!unit.verify) {
    return null;
  }
  const status = verifyRowStatus[unit.verify];
  const running = unit.verify === 'running';
  const duration = unit.verifyStartedAt != null && unit.verifyEndedAt != null
    ? unit.verifyEndedAt - unit.verifyStartedAt
    : null;
  const sessionId = unit.verifySessionId;
  return (
    <li
      data-slot="jobs-sidebar-verify"
      data-status={status}
      data-live={running ? 'true' : undefined}
      onClick={sessionId ? () => onOpenSession(sessionId) : undefined}
      className={cn(
        'flex min-h-5 items-center gap-1.5 text-[11px] leading-4',
        status === 'completed' && 'text-muted-foreground/45',
        status === 'in-progress' && 'text-foreground',
        status === 'cancelled' && 'text-muted-foreground/60',
        sessionId && 'cursor-pointer hover:text-foreground',
      )}
    >
      <span className="flex-shrink-0 scale-[0.7]">
        <TodoStatusIcon status={status} />
      </span>
      <span className="min-w-0 truncate">{verifyRowLabel[unit.verify]}</span>
      <span className="ml-auto flex-shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/45">
        {running && unit.verifyStartedAt != null
          ? <LiveElapsed startedAt={unit.verifyStartedAt} />
          : duration != null ? formatDuration(duration) : null}
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
 * One run of the project in the jobs list (ui14 job 1): a dispatch chain with
 * its units, or a chain-less run that renders as a single job row.
 */
export type JobGroup = {
  chain: ChainSnapshot | null;
  /** Chain-less run: label and state for its one row. */
  run: { label: string; state: 'running' | 'finished' | 'stopped' } | null;
  /** Unit index → session id, for the units that have a session to open. */
  sessions: Record<number, string>;
  /** Ordering key: newer groups sit higher in the list. */
  startedAt: number;
};

/** A unit with its bottom-to-top position in the flat list (1 = oldest). */
type PositionedUnit = Unit & { position: number };

type JobsSidebarProps = {
  /** Every run of the project, newest first. */
  groups: JobGroup[];
  /** The session the pane is showing; marks its row. */
  activeSessionId: string | null;
  /** Navigate the worker pane to a unit's session. */
  onOpenSession: (sessionId: string) => void;
};

/**
 * The jobs list (ui12 phase 5 sidebar; a side column or full-pane view since
 * ui14 job 1): the primary status surface for the project's dispatched runs,
 * toggled by the worker top bar's job sign. One continuous list across every
 * run of the project, ordered bottom-to-top — the oldest run's job 1 at the
 * bottom, later jobs and later runs stacking upward, the newest (or queued)
 * job on top — with the full history scrollable in place. Every job is a
 * collapsible task drawer; task rows carry check/working/idle status icons,
 * the job row's ring advances with its done/total counter, and entries
 * stagger in as a manifest (or an append) lands.
 */
export default function JobsSidebar({ groups, activeSessionId, onOpenSession }: JobsSidebarProps) {
  const reduce = useReducedMotion() ?? false;

  // Newest group first, each group's newest unit first — the flat list is
  // already top-to-bottom; positions count from the bottom for the stagger.
  const stacked: PositionedUnit[] = [];
  for (const group of groups) {
    const units: Unit[] = group.chain
      ? chainUnits(group.chain)
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
      stacked.push({ ...unit, sessionId: group.sessions[unit.index], position: 0 });
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
  // Hover marquee on job rows (ui13 job 3): mouse enter/leave is effectively
  // fine-pointer only — touch taps act before hover matters.
  const [hoveredJob, setHoveredJob] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Populate animation: units past the previously rendered count are new (a
  // manifest landing or an append) and stagger in one by one; settled rows
  // never replay their entrance.
  const seenCountRef = useRef(0);
  const seenCount = seenCountRef.current;
  useEffect(() => {
    seenCountRef.current = stacked.length;
  }, [stacked.length]);

  return (
    <section
      aria-label="Jobs"
      data-slot="jobs-sidebar"
      className="flex h-full min-w-0 flex-col bg-muted/20"
    >
      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence initial={false}>
          {stacked.map((unit) => {
            const hasDrawer = unit.tasks.length > 0;
            const drawerOpen = hasDrawer
              && (drawerOverrides[unit.key] ?? unit.key === defaultOpenKey);
            // Jobs are the navigation (ui13 job 2): a unit with a session
            // navigates the pane on row click; the title alone toggles the
            // drawer. Units without sessions keep the whole-row toggle.
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
              unit.kind === 'task' ? 'text-[12px]' : 'text-[13px]',
              unit.status === 'pending' && 'text-muted-foreground/65',
              unit.status === 'in-progress' && 'text-foreground',
              unit.status === 'completed' && 'text-muted-foreground/60',
              unit.status === 'cancelled' && 'text-muted-foreground/55',
              unit.paused && 'text-foreground',
              (hasDrawer || navigable) && 'group-hover/row:text-foreground',
            );
            return (
              <motion.li
                key={unit.key}
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
              >
                <div
                  onClick={
                    navigable
                      ? open
                      : hasDrawer
                        ? toggleDrawer
                        : undefined
                  }
                  data-slot="jobs-sidebar-row"
                  data-job={unit.index}
                  data-chain={unit.chainSlug ?? undefined}
                  data-kind={unit.kind}
                  data-status={unit.paused ? 'paused' : unit.status}
                  data-drawer={hasDrawer ? (drawerOpen ? 'open' : 'closed') : undefined}
                  data-active={active ? 'true' : undefined}
                  onMouseEnter={() => setHoveredJob(unit.key)}
                  onMouseLeave={() => setHoveredJob((current) => (current === unit.key ? null : current))}
                  className={cn(
                    'group/row relative flex w-full items-center gap-2 rounded-md px-1.5 text-left',
                    unit.kind === 'task' ? 'min-h-7 pl-4' : 'min-h-8',
                    (hasDrawer || navigable) && 'cursor-pointer',
                    navigable && 'hover:bg-accent/50',
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
                  <span className={cn(unit.kind === 'task' && 'scale-90')}>
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
                          // The job ring is a static circle segmented per task
                          // from the start (ui13 job 7): idle jobs show the
                          // same ring muted and motionless; the active job's
                          // fills as check-offs land, its working segment
                          // glowing. A manifest-less job keeps a plain circle
                          // (ramped spinner while working).
                          segments={
                            unit.tasks.length > 0
                            && (unit.status === 'in-progress' || unit.status === 'pending' || unit.verify === 'running')
                              ? {
                                  done: unit.verify === 'running' ? unit.tasks.length : displayedDone(unit),
                                  total: unit.tasks.length,
                                }
                              : undefined
                          }
                        />
                      )}
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
                        <MarqueeLabel active={hoveredJob === unit.key} className="flex-initial">
                          {unit.name}
                        </MarqueeLabel>
                      </button>
                    ) : (
                      <span className={titleClasses}>
                        <MarqueeLabel active={hoveredJob === unit.key} className="flex-initial">
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
                            key={`${unit.key}-${taskIndex}`}
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
                      <EngineRow unit={unit} />
                      <JobFooter unit={unit} />
                      <VerifyRow unit={unit} onOpenSession={onOpenSession} />
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
