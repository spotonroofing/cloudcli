import { Compass, Hammer } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { NumberTicker } from '../../../../shared/view/beui';

/** Compact monochrome activity stack at the taskbar's right edge. */
export default function ActivityCounterButton({
  plannerCount,
  workerCount,
  plannerLabel,
  workerLabel,
  onOpen,
  selected = false,
  dimmed = false,
}: {
  plannerCount: number;
  workerCount: number;
  plannerLabel: string;
  workerLabel: string;
  onOpen: () => void;
  selected?: boolean;
  dimmed?: boolean;
}) {
  const plannerActive = plannerCount > 0;
  const workerActive = workerCount > 0;
  const both = plannerActive && workerActive;
  if (!plannerActive && !workerActive) return null;

  const ariaLabel = [
    workerActive ? `${workerLabel}: ${workerCount}` : null,
    plannerActive ? `${plannerLabel}: ${plannerCount}` : null,
  ].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      data-slot="activity-counter-button"
      data-kinds={both ? 'planner worker' : plannerActive ? 'planner' : 'worker'}
      data-planner-count={plannerCount}
      data-worker-count={workerCount}
      data-layout={both ? 'stacked' : 'single'}
      onClick={onOpen}
      aria-label={ariaLabel}
      title={ariaLabel}
      aria-expanded={selected}
      className={cn(
        'touch-hit ml-auto flex h-9 min-w-9 cursor-pointer flex-col items-center justify-center rounded-lg px-2 text-[10px] font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'bg-accent/60 text-foreground'
          : dimmed
            ? 'text-muted-foreground/40 hover:text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {workerActive && (
        <span className="flex h-3.5 items-center justify-center gap-1" data-kind="worker">
          <Hammer className="h-3 w-3 flex-shrink-0" aria-hidden />
          <NumberTicker value={workerCount} className="min-w-2 tabular-nums" />
        </span>
      )}
      {plannerActive && (
        <span className="flex h-3.5 items-center justify-center gap-1" data-kind="planner">
          <Compass className="h-3 w-3 flex-shrink-0" aria-hidden />
          <NumberTicker value={plannerCount} className="min-w-2 tabular-nums" />
        </span>
      )}
    </button>
  );
}
