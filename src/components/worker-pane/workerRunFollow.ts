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

/**
 * The shape of a chain snapshot the pane title and the jobs drawers read
 * (ui18 job 4). Structural on purpose: the sidebar's full `ChainSnapshot`
 * satisfies it, and this module stays free of React.
 */
export type FollowableChain = {
  slug: string;
  status: string;
  currentPhase: number | null;
  phaseActive: boolean;
  manifest?: { name: string; commitHash?: string }[] | null;
  startedAt?: number;
};

/**
 * The chain whose work the pane is watching: the followed session's own chain
 * while it runs, else the newest chain still running or paused. Preferring the
 * followed one matters because a chain that died without its terminal event
 * stays "running" forever and would otherwise speak for the pane.
 */
export function activeWorkerChain<T extends FollowableChain>(
  chains: T[],
  followedSlug: string | null = null,
): T | null {
  const running = (chain: FollowableChain) => chain.status === 'running' || chain.status === 'paused';
  const followed = followedSlug ? chains.find((chain) => chain.slug === followedSlug) : undefined;
  if (followed && running(followed)) {
    return followed;
  }
  let active: T | null = null;
  for (const chain of chains) {
    if (!running(chain)) continue;
    if (!active || (chain.startedAt ?? 0) > (active.startedAt ?? 0)) {
      active = chain;
    }
  }
  return active;
}

/**
 * The unit the work is on right now, as the jobs list's own `slug:index` key.
 * Null between units: a chain that has finished a unit and not yet started the
 * next one is at a boundary, and a boundary forces no drawer open.
 */
export function activeUnitKey(chains: FollowableChain[], followedSlug: string | null = null): string | null {
  const active = activeWorkerChain(chains, followedSlug);
  if (!active || active.status !== 'running' || !active.phaseActive || !active.currentPhase) {
    return null;
  }
  return `${active.slug}:${active.currentPhase}`;
}

/**
 * Which job drawers are open: the unit being worked on, plus every open or
 * close the reader made by hand since the last boundary. The sidebar drops
 * those overrides at each boundary, so the drawers follow the work again.
 */
export function drawerOpenKeys(
  drawerKeys: string[],
  overrides: Record<string, boolean>,
  activeKey: string | null,
): string[] {
  return drawerKeys.filter((key) => overrides[key] ?? key === activeKey);
}

/**
 * The worker pane's title (ui18 job 4): the name of the unit being worked on
 * while a chain runs, else the last unit the followed chain landed, which the
 * header renders in the jobs list's completed treatment. Null when no chain
 * has anything to name, and the pane falls back to its session title.
 */
export function workerPaneJobTitle(
  chains: FollowableChain[],
  followedSlug: string | null,
): { name: string; state: 'running' | 'done' } | null {
  const active = activeWorkerChain(chains, followedSlug);
  if (active) {
    const name = active.currentPhase ? active.manifest?.[active.currentPhase - 1]?.name : undefined;
    if (name) {
      return { name, state: 'running' };
    }
  }
  const followed = followedSlug ? chains.find((chain) => chain.slug === followedSlug) ?? null : null;
  const landed = [...(followed?.manifest ?? [])].reverse().find((entry) => entry.commitHash);
  return landed ? { name: landed.name, state: 'done' } : null;
}
