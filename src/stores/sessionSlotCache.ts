export const SESSION_SLOT_CACHE_LIMIT = 3;
export const ACTIVE_SESSION_MESSAGE_LIMIT = 80;
export const HIDDEN_SESSION_MESSAGE_LIMIT = 1;

export function boundedTail<T>(items: T[], limit: number): T[] {
  return items.length > limit ? items.slice(-limit) : items;
}

/**
 * Keeps an automatic latest-page refresh from turning into an ever-growing
 * persisted transcript cache. Trimming means older rows remain available via
 * pagination even when the server says the fetched sequence reached its
 * beginning.
 */
export function boundPersistedWindow<T>(
  items: T[],
  limit: number,
  hasMore: boolean,
): { items: T[]; hasMore: boolean } {
  const bounded = boundedTail(items, limit);
  return {
    items: bounded,
    hasMore: hasMore || bounded !== items,
  };
}

/**
 * Marks one session slot as most recently used and trims the cache without
 * ever evicting the session currently shown by this ChatInterface.
 */
export function touchSessionSlot<T>(
  slots: Map<string, T>,
  sessionId: string,
  create: () => T,
  activeSessionId: string | null,
  limit = SESSION_SLOT_CACHE_LIMIT,
): T {
  let slot = slots.get(sessionId);
  if (slot !== undefined) {
    slots.delete(sessionId);
  } else {
    slot = create();
  }
  slots.set(sessionId, slot);

  while (slots.size > limit) {
    let evictable: string | undefined;
    for (const key of slots.keys()) {
      if (key !== activeSessionId) {
        evictable = key;
        break;
      }
    }
    if (evictable === undefined) break;
    slots.delete(evictable);
  }

  return slot;
}
