export type FollowableWorkerRun = {
  sessionId: string;
  chainStage?: 'verify';
  /** Honest creation time; transcript activity must not outrank a newer job. */
  startedAt?: number | string | null;
};

/** An explicit older-session selection pauses job-start follow for one minute. */
export const WORKER_SESSION_PIN_MS = 60_000;

const runStartedAt = (run: FollowableWorkerRun): number => {
  if (typeof run.startedAt === 'number') return run.startedAt;
  if (typeof run.startedAt === 'string') {
    const parsed = Date.parse(run.startedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

/** The worker pane follows the newest build/direct start, never a verifier. */
export function findWorkerFollowTarget<T extends FollowableWorkerRun>(runs: T[]): T | null {
  let target: T | null = null;
  let targetStartedAt = 0;
  for (const run of runs) {
    if (run.chainStage === 'verify') continue;
    const startedAt = runStartedAt(run);
    if (!target || startedAt > targetStartedAt) {
      target = run;
      targetStartedAt = startedAt;
    }
  }
  return target;
}

/** A verifier is always an intentional pin, even when it is the newest row. */
export function selectedRunKeepsAutoFollow(
  selected: FollowableWorkerRun,
  followTarget: FollowableWorkerRun | null,
): boolean {
  return selected.chainStage !== 'verify' && selected.sessionId === followTarget?.sessionId;
}

/** Expiry for an explicit selection; selecting the live build clears the pin. */
export function workerSessionPinUntil(
  selected: FollowableWorkerRun | null,
  followTarget: FollowableWorkerRun | null,
  now = Date.now(),
): number {
  return selected && selectedRunKeepsAutoFollow(selected, followTarget)
    ? 0
    : now + WORKER_SESSION_PIN_MS;
}

/** A new build may replace the pane once the user's one-minute pin expires. */
export function shouldFollowWorkerRun(
  followTarget: FollowableWorkerRun | null,
  currentSessionId: string | null,
  pinnedUntil: number,
  now = Date.now(),
): boolean {
  return Boolean(
    followTarget
    && followTarget.sessionId !== currentSessionId
    && now >= pinnedUntil,
  );
}

/**
 * Preserve the selected-session object when the id did not change. This keeps
 * the chat tree and its transcript rows mounted across run-list refreshes.
 */
export function preserveWorkerSessionSelection<T extends { id: string }>(
  current: T | null,
  next: T,
): T {
  return current?.id === next.id ? current : next;
}

/** Known-run transcript writes do not need to refetch the run navigator. */
export function sessionUpsertNeedsRunRefresh(
  sessionId: string | null,
  knownRunIds: ReadonlySet<string>,
): boolean {
  return !sessionId || !knownRunIds.has(sessionId);
}
