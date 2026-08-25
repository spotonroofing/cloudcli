/**
 * The session id whose persisted transcript should refresh when a
 * `session_upserted` frame arrives (ui11 phase 10). Externally-driven runs
 * (dispatched chains, headless CLI sessions) never stream through the chat
 * run registry — the filesystem watcher's `session_upserted` broadcast is
 * their only live signal — so the viewed session refetches its tail on that
 * frame. Returns null for other sessions' upserts or id-less frames.
 */
export function sessionUpsertRefreshTarget(
  event: { kind?: string; sessionId?: unknown },
  activeViewSessionId: string | null,
): string | null {
  if (event.kind !== 'session_upserted' || !activeViewSessionId) {
    return null;
  }
  return event.sessionId === activeViewSessionId ? activeViewSessionId : null;
}

export type MessageHistoryRefreshExecutor = (sessionId: string) => Promise<boolean | void>;
export type CanRefreshMessageHistory = (sessionId: string) => boolean;

export type MessageHistoryRefreshCoordinator = {
  request: (sessionId: string, allowNetwork?: boolean) => Promise<void>;
  flushPending: (sessionId: string) => Promise<void>;
  discardPending: (sessionId: string) => void;
  hasPending: (sessionId: string) => boolean;
};

/**
 * Coalesces automatic persisted-history refresh signals without owning any
 * React state. Hidden sessions remain dirty until they become visible; active
 * bursts collapse into the current request plus at most one trailing request.
 */
export function createMessageHistoryRefreshCoordinator(
  executeRefresh: MessageHistoryRefreshExecutor,
  canRefreshNow: CanRefreshMessageHistory,
): MessageHistoryRefreshCoordinator {
  const pendingSessions = new Set<string>();
  const inFlightBySession = new Map<string, Promise<void>>();

  const drain = (sessionId: string): Promise<void> => {
    const existing = inFlightBySession.get(sessionId);
    if (existing) {
      pendingSessions.add(sessionId);
      return existing;
    }

    const request = (async () => {
      try {
        do {
          pendingSessions.delete(sessionId);
          const completed = await executeRefresh(sessionId);
          if (completed === false) {
            pendingSessions.add(sessionId);
            break;
          }
        } while (pendingSessions.has(sessionId) && canRefreshNow(sessionId));
      } catch {
        pendingSessions.add(sessionId);
      }
    })().finally(() => {
      inFlightBySession.delete(sessionId);
    });

    inFlightBySession.set(sessionId, request);
    return request;
  };

  return {
    request(sessionId: string, allowNetwork = true): Promise<void> {
      if (!allowNetwork || !canRefreshNow(sessionId)) {
        pendingSessions.add(sessionId);
        return Promise.resolve();
      }
      return drain(sessionId);
    },

    flushPending(sessionId: string): Promise<void> {
      if (!pendingSessions.has(sessionId) || !canRefreshNow(sessionId)) {
        return Promise.resolve();
      }
      return drain(sessionId);
    },

    discardPending(sessionId: string): void {
      pendingSessions.delete(sessionId);
    },

    hasPending(sessionId: string): boolean {
      return pendingSessions.has(sessionId);
    },
  };
}
