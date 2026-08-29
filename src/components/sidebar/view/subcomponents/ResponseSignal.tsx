import { Bell } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type ActivityKinds = {
  planner: boolean;
  worker: boolean;
};

/**
 * Quiet unseen-response mark shared by chat rows, collapsed project rows,
 * and the footer activity button (ui17 job 15). One muted bell, whatever
 * answered: the row does not need to say planner or worker, the footer's own
 * icons already do. It appears when a turn finished after the session was
 * last opened and disappears the moment it is opened.
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
      aria-label="Unseen response"
      data-slot="response-indicator"
      data-planner={kinds.planner || undefined}
      data-worker={kinds.worker || undefined}
      className={cn('flex h-3 w-3 flex-shrink-0 items-center justify-center', className)}
    >
      <Bell aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
    </span>
  );
}
