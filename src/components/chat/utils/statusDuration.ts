/** Exact transcript status duration with decisecond precision below one hour. */
export function formatStatusDuration(durationMs: number): string {
  const totalDeciseconds = Math.round(Math.max(0, durationMs) / 100);
  if (totalDeciseconds < 600) return `${(totalDeciseconds / 10).toFixed(1)}s`;
  const minutes = Math.floor(totalDeciseconds / 600);
  const secondsDeciseconds = totalDeciseconds - minutes * 600;
  if (minutes < 60) {
    return secondsDeciseconds
      ? `${minutes}m ${(secondsDeciseconds / 10).toFixed(1)}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Converts any supported transcript timestamp into an epoch value. */
export function statusStartedAt(value: string | number | Date | undefined): number | null {
  if (value === undefined) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
