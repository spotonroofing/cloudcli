import { ChevronDown, ListTodo } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '../../../lib/utils';

import { AgentDisclosure } from './AgentDisclosure';
import { SwapText } from './SwapText';
import { EASE_OUT, SPRING_SWAP } from './ease';

// beUI todo-list (beui.dev/components/agents/todo-list), vendored with the
// donor's spacing/sizing/motion; radius is the app token (rounded-lg/md, not
// the donor's 2xl/xl) and the count swap reuses the app's SwapText (the
// vendored ActionSwapRollText equivalent). SPRING_LAYOUT is a donor ease
// token missing from the shared ease.ts, so it lives here.
const SPRING_LAYOUT = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

export type TodoListItemStatus =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'cancelled';

export interface TodoListItem {
  id: string;
  title: ReactNode;
  status?: TodoListItemStatus;
  progress?: number;
  detail?: ReactNode;
}

export interface TodoListProps {
  items: TodoListItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number;
  className?: string;
}

function statusLabel(status: TodoListItemStatus) {
  if (status === 'in-progress') return 'In progress';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Pending';
}

function TodoHeaderIcon({ complete }: { complete: boolean }) {
  const reduce = useReducedMotion() ?? false;

  return (
    <span
      aria-hidden="true"
      className="relative grid size-6 shrink-0 place-items-center"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {complete ? (
          <motion.svg
            key="complete"
            viewBox="0 0 24 24"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute size-[1.375rem] overflow-visible text-status-done"
          >
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <motion.path
              d="M7.5 12.25 10.5 15.25 16.75 8.75"
              fill="none"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={
                reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }
              }
            />
          </motion.svg>
        ) : (
          <motion.span
            key="todo"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute grid place-items-center text-muted-foreground"
          >
            <ListTodo className="size-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function TodoStatusIcon({
  status,
  progress,
  segments,
  sweepOnComplete = false,
}: {
  status: TodoListItemStatus;
  progress?: number;
  /**
   * Job ring (ui12 job 8): while in-progress, render a static circle
   * segmented per task with small gaps; the first `done` segments fill green.
   */
  segments?: { done: number; total: number };
  /**
   * Play the full-circle sweep before the check when completion lands while
   * mounted (job rows); a row that mounts already completed shows the plain
   * drawn check.
   */
  sweepOnComplete?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const normalizedProgress =
    progress === undefined ? 0.68 : Math.min(100, Math.max(0, progress)) / 100;
  const hasSegments =
    status === 'in-progress' && segments !== undefined && segments.total > 0;

  // Completion sweep arming: only a completed status that arrives while this
  // icon is mounted in another state sweeps — loaded history renders settled.
  // Armed during render (derive-state-from-props), not in an effect, so the
  // checkmark's sweep delay is in place on the same commit the status flips.
  const previousStatus = useRef(status);
  const [sweeping, setSweeping] = useState(false);
  if (previousStatus.current !== status) {
    previousStatus.current = status;
    if (
      sweepOnComplete
      && !reduce
      && status === 'completed'
      // Re-read the media query at transition time: useReducedMotion caches
      // its value per subscription and can lag an emulated/system change.
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setSweeping(true);
    } else if (sweeping) {
      setSweeping(false);
    }
  }

  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      initial={false}
      className={cn(
        // Semantic status inks (ui12 phase 4): done green, working accent,
        // idle muted — the sanctioned exception to monochromatic icons.
        'mx-0.5 size-5 shrink-0 overflow-visible text-status-idle',
        status === 'in-progress' && 'text-status-working',
        status === 'completed' && 'text-status-done',
        status === 'cancelled' && 'text-rose-600 dark:text-rose-400',
      )}
    >
      {!hasSegments && (
        <motion.circle
          cx="12"
          cy="12"
          r="9"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={status === 'pending' ? '2 3' : undefined}
          strokeLinecap="round"
          initial={false}
          animate={{ fillOpacity: status === 'completed' ? 0.06 : 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
          className={cn(status === 'in-progress' && 'opacity-20')}
        />
      )}
      {!hasSegments && (
        // The working arc — the app's ramped partial-circle spinner. Rotation
        // is the CSS spinner-ramp animation (transform-only, reduced-motion
        // aware); the static -90° fallback anchors the arc at 12 o'clock for
        // determinate progress and reduced motion.
        <g
          className={cn(
            status === 'in-progress'
              && progress === undefined
              && 'animate-spinner-ramp',
          )}
          style={{ transformOrigin: '12px 12px', transform: 'rotate(-90deg)' }}
        >
          <motion.circle
            cx="12"
            cy="12"
            r="9"
            pathLength="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            initial={false}
            animate={{
              pathLength: status === 'in-progress' ? normalizedProgress : 0,
              opacity: status === 'in-progress' ? 1 : 0,
            }}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          />
        </g>
      )}
      {hasSegments && (
        <g style={{ transformOrigin: '12px 12px', transform: 'rotate(-90deg)' }}>
          {Array.from({ length: segments.total }, (_, i) => {
            const frac = 1 / segments.total;
            const gap = Math.min(0.05, frac / 3);
            const done = i < segments.done;
            return (
              <circle
                key={i}
                data-slot="job-ring-segment"
                data-done={done}
                cx="12"
                cy="12"
                r="9"
                pathLength="1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={`${frac - gap} ${1 - frac + gap}`}
                strokeDashoffset={-(i * frac + gap / 2)}
                className={cn(
                  'transition-[color,opacity] duration-300',
                  done ? 'text-status-done' : 'text-status-idle opacity-40',
                )}
              />
            );
          })}
        </g>
      )}
      {sweeping && status === 'completed' && (
        // CSS-animated, not motion: the parent svg's initial={false}
        // suppresses motion mount animations, so this circle would render
        // at its end state. The status-sweep keyframes draw the full
        // circle then fade (see src/index.css).
        <circle
          data-slot="status-sweep"
          cx="12"
          cy="12"
          r="9"
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="1 1"
          className="animate-status-sweep"
          style={{ transformOrigin: '12px 12px', transform: 'rotate(-90deg)' }}
        />
      )}
      <motion.path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{
          pathLength: status === 'completed' ? 1 : 0,
          opacity: status === 'completed' ? 1 : 0,
        }}
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 0.24, ease: EASE_OUT, delay: sweeping ? 0.42 : 0 }
        }
      />
      <motion.path
        d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{
          pathLength: status === 'cancelled' ? 1 : 0,
          opacity: status === 'cancelled' ? 1 : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
      />
    </motion.svg>
  );
}

export function TodoList({
  items,
  title = 'To-dos',
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  maxHeight = 248,
  className,
}: TodoListProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousComplete = useRef(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const completed = items.filter((item) => item.status === 'completed').length;
  const allComplete = items.length > 0 && completed === items.length;
  const itemCount = items.length;

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousComplete.current && !allComplete) {
      setOpen(true);
    }
    if (!previousComplete.current && allComplete && collapseOnComplete) {
      setOpen(false);
    }
    previousComplete.current = allComplete;
  }, [allComplete, collapseOnComplete, setOpen]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || itemCount === 0) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? 'auto' : 'smooth',
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [itemCount, reduce]);

  return (
    <section
      aria-label="Agent task list"
      data-slot="todo-list"
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border/70',
        className,
      )}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex h-11 w-full items-center gap-2.5 rounded-lg px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TodoHeaderIcon complete={allComplete} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
          {title}
        </h3>
        <span
          className={cn(
            'shrink-0 text-xs font-medium tabular-nums text-muted-foreground',
            allComplete && 'text-status-done',
          )}
        >
          <span className="sr-only">
            {completed} of {items.length} tasks completed
          </span>
          <span aria-hidden="true" className="inline-flex">
            <SwapText value={String(completed)}>{completed}</SwapText>
            <span>/</span>
            <span>{items.length}</span>
          </span>
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={currentOpen}
      >
        <div
          ref={viewportRef}
          className="scrollbar-hide overflow-y-auto px-2 pb-2"
          style={{ maxHeight }}
        >
          {items.length ? (
            <ol aria-live="polite" className="space-y-0">
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((item) => {
                  const status = item.status ?? 'pending';
                  return (
                    <motion.li
                      layout="position"
                      key={item.id}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : {
                              opacity: { duration: 0.18, ease: EASE_OUT },
                              y: SPRING_LAYOUT,
                              layout: SPRING_LAYOUT,
                            }
                      }
                      className="flex min-h-9 items-center gap-2.5 rounded-md px-1.5 py-1"
                    >
                      <TodoStatusIcon status={status} progress={item.progress} />
                      <span className="sr-only">{statusLabel(status)}: </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm leading-5',
                          status === 'pending' && 'text-muted-foreground/65',
                          status === 'in-progress' && 'text-foreground',
                          status === 'completed' && 'text-muted-foreground/60',
                          status === 'cancelled' && 'text-muted-foreground/55',
                        )}
                      >
                        <span className="relative inline-block max-w-full">
                          {item.title}
                          <motion.span
                            aria-hidden="true"
                            initial={false}
                            animate={{
                              scaleX: status === 'completed' ? 1 : 0,
                              opacity: status === 'completed' ? 1 : 0,
                            }}
                            transition={
                              reduce
                                ? { duration: 0 }
                                : { duration: 0.28, ease: EASE_OUT, delay: 0.06 }
                            }
                            className="absolute inset-x-0 top-1/2 h-px origin-left bg-current"
                          />
                        </span>
                      </span>
                      {item.detail ? (
                        <span className="shrink-0 text-sm text-muted-foreground/55">
                          {item.detail}
                        </span>
                      ) : null}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          ) : (
            <p className="px-1.5 py-2 text-sm text-muted-foreground">
              No tasks yet
            </p>
          )}
        </div>
      </AgentDisclosure>
    </section>
  );
}
