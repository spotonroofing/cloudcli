import { useEffect, useState } from 'react';

import { formatStatusDuration, statusStartedAt } from '../../utils/statusDuration';

type StatusDurationProps = {
  startedAt?: string | number | Date;
  durationMs?: number;
  running?: boolean;
  className?: string;
};

/**
 * Shared muted meta for transcript rows that can hang. Completed rows show
 * their exact duration; active rows tick from their phase/tool start.
 */
export default function StatusDuration({
  startedAt,
  durationMs,
  running = false,
  className = '',
}: StatusDurationProps) {
  const start = statusStartedAt(startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || start === null) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [running, start]);

  const elapsed = running && start !== null
    ? Math.max(0, now - start)
    : typeof durationMs === 'number' && Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : null;
  if (elapsed === null) return null;

  return (
    <span
      data-slot="status-duration"
      data-state={running ? 'running' : 'done'}
      className={`shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60 ${className}`}
    >
      {formatStatusDuration(elapsed)}
    </span>
  );
}
