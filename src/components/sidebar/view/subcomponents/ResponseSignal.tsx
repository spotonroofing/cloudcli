import { cn } from '../../../../lib/utils';

export type ActivityKinds = {
  planner: boolean;
  worker: boolean;
};

/**
 * Quiet unread-response mark shared by chat rows, collapsed project rows,
 * and the footer activity button. It deliberately uses short strokes rather
 * than another dot: planner is one primary-ink stroke, worker is a paired
 * emerald stroke, and both stack without needing a label.
 */
export default function ResponseSignal({
  kinds,
  className,
}: {
  kinds: ActivityKinds;
  className?: string;
}) {
  if (!kinds.planner && !kinds.worker) return null;

  return (
    <span
      aria-label={
        kinds.planner && kinds.worker
          ? 'Unseen planner and worker responses'
          : kinds.planner
            ? 'Unseen planner response'
            : 'Unseen worker response'
      }
      data-slot="response-indicator"
      data-planner={kinds.planner || undefined}
      data-worker={kinds.worker || undefined}
      className={cn('flex h-3 w-2.5 flex-shrink-0 flex-col justify-center gap-[2px]', className)}
    >
      {kinds.planner && (
        <span
          aria-hidden="true"
          className="h-px w-2.5 rounded-full bg-primary/75"
          data-slot="response-indicator-planner"
        />
      )}
      {kinds.worker && (
        <span
          aria-hidden="true"
          className="flex items-center gap-px"
          data-slot="response-indicator-worker"
        >
          <span className="h-px w-1 rounded-full bg-emerald-600/75 dark:bg-emerald-300/75" />
          <span className="h-px w-1.5 rounded-full bg-emerald-600/75 dark:bg-emerald-300/75" />
        </span>
      )}
    </span>
  );
}
