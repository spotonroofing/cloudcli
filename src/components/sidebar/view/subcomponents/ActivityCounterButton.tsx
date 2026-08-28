import { Compass, Hammer } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { NumberTicker } from '../../../../shared/view/beui';

import ResponseSignal, { type ActivityKinds } from './ResponseSignal';

/** One full-width footer button; its interior becomes a two-kind split. */
export default function ActivityCounterButton({
  plannerCount,
  workerCount,
  plannerLabel,
  workerLabel,
  responseKinds,
  onOpen,
}: {
  plannerCount: number;
  workerCount: number;
  plannerLabel: string;
  workerLabel: string;
  responseKinds: ActivityKinds;
  onOpen: () => void;
}) {
  const plannerActive = plannerCount > 0;
  const workerActive = workerCount > 0;
  const both = plannerActive && workerActive;
  const visibleResponses = {
    planner: plannerActive && responseKinds.planner,
    worker: workerActive && responseKinds.worker,
  };

  return (
    <button
      type="button"
      data-slot="activity-counter-button"
      data-kinds={both ? 'planner worker' : plannerActive ? 'planner' : 'worker'}
      data-planner-count={plannerCount}
      data-worker-count={workerCount}
      onClick={onOpen}
      className="flex w-full min-w-0 cursor-pointer items-center justify-center rounded-lg py-2 text-[11px] font-medium outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {plannerActive && (
        <span className={cn('flex min-w-0 items-center justify-center gap-1.5 text-primary', !both && 'animate-counter-breathe')}>
          <Compass className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{plannerLabel}</span>
          <NumberTicker value={plannerCount} className="tabular-nums" />
        </span>
      )}
      {both && <span className="mx-3 h-4 w-px flex-shrink-0 bg-border/70" aria-hidden />}
      {workerActive && (
        <span className={cn('flex min-w-0 items-center justify-center gap-1.5 text-emerald-700 dark:text-emerald-300', !both && 'animate-counter-breathe')}>
          <Hammer className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{workerLabel}</span>
          <NumberTicker value={workerCount} className="tabular-nums" />
        </span>
      )}
      <ResponseSignal kinds={visibleResponses} className="ml-2" />
    </button>
  );
}
