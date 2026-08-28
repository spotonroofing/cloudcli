import { formatStatusDuration, statusStartedAt } from '../../utils/statusDuration';
import { useSharedNow } from '../../../../hooks/useSharedNow';

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
  const now = useSharedNow(running && start !== null, 100);

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
