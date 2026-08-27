export type FollowableWorkerRun = {
  sessionId: string;
  chainStage?: 'verify';
};

/** The worker pane follows the newest build/direct run, never a verifier. */
export function findWorkerFollowTarget<T extends FollowableWorkerRun>(runs: T[]): T | null {
  return runs.find((run) => run.chainStage !== 'verify') ?? null;
}

/** A verifier is always an intentional pin, even when it is the newest row. */
export function selectedRunKeepsAutoFollow(
  selected: FollowableWorkerRun,
  followTarget: FollowableWorkerRun | null,
): boolean {
  return selected.chainStage !== 'verify' && selected.sessionId === followTarget?.sessionId;
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
