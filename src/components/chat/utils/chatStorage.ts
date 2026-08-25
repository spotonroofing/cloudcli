import { authenticatedFetch } from '../../../utils/api';
import type { ClaudeSettings } from '../types/types';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const draftKeys = keys.filter((k) => k.startsWith('draft_input_') || k.startsWith('queued_message_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

/**
 * Composer options captured when a message is queued, so the message can be
 * sent later with the exact settings (model, permission mode, tools) the
 * session's composer had at queue time — even from outside the composer,
 * e.g. the app-level auto-send that fires while another session is viewed.
 */
export type QueuedSendOptions = Record<string, unknown>;

export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
};

/**
 * Server-persisted queued messages (ui11 phase 1). The in-memory cache is the
 * synchronous view every reader uses; it is filled by `hydrateQueuedMessages`
 * at app load, kept current by `queued_message_updated` broadcasts, and
 * written through to `/api/queued-messages` on every local change. Network
 * calls are serialized per session so a write never overtakes its clear.
 */

export const queuedClientId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const cache = new Map<string, StoredQueuedMessage>();
const listeners = new Set<(sessionId: string) => void>();
const tails = new Map<string, Promise<unknown>>();
/**
 * Sessions whose latest local write has not been acknowledged by the server
 * (the PUT failed, e.g. across a dev-server restart). Hydration preserves and
 * re-pushes these instead of wiping them to server state — they are a live
 * tab's own in-flight write, not a stale remnant, and dropping them would
 * lose the message. The set is in-memory only, so nothing here survives a
 * shutdown to ghost-send later.
 */
const pendingWrites = new Set<string>();

const notify = (sessionId: string) => {
  listeners.forEach((listener) => listener(sessionId));
};

const enqueue = <T>(sessionId: string, operation: () => Promise<T>): Promise<T> => {
  const next = (tails.get(sessionId) ?? Promise.resolve()).then(operation, operation);
  tails.set(sessionId, next);
  return next;
};

const normalize = (message: StoredQueuedMessage): StoredQueuedMessage => ({
  content: message.content,
  options: message.options,
  attachments: message.attachments ?? message.images ?? [],
});

const serialize = (message: StoredQueuedMessage) =>
  JSON.stringify({ content: message.content, options: message.options ?? null, attachments: message.attachments ?? [] });

const endpoint = (sessionId: string) => `/api/queued-messages/${encodeURIComponent(sessionId)}`;

/** Notified when another device (or hydration) changes a session's queued message. */
export function subscribeQueuedMessages(listener: (sessionId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readQueuedMessage(sessionId: string): StoredQueuedMessage | null {
  const message = cache.get(sessionId);
  if (!message) {
    return null;
  }
  return message.content.trim() || (message.attachments?.length ?? 0) > 0 ? message : null;
}

const pushQueuedMessage = (sessionId: string, message: StoredQueuedMessage): Promise<unknown> =>
  enqueue(sessionId, () =>
    authenticatedFetch(endpoint(sessionId), {
      method: 'PUT',
      body: JSON.stringify({ ...message, clientId: queuedClientId }),
    }).then((response) => {
      if (response.ok) {
        pendingWrites.delete(sessionId);
      }
    }).catch(() => {
      // Stays in pendingWrites; the next hydrate re-pushes it.
    }),
  );

export function writeQueuedMessage(sessionId: string, message: StoredQueuedMessage): void {
  const normalized = normalize(message);
  const previous = cache.get(sessionId);
  if (previous && serialize(previous) === serialize(normalized)) {
    return;
  }
  cache.set(sessionId, normalized);
  pendingWrites.add(sessionId);
  void pushQueuedMessage(sessionId, normalized);
}

/**
 * A chat.send frame that found the socket dead lands back in the server queue
 * instead of a client-memory buffer (ui12 phase 1): the composer flush and
 * app-level auto-send deliver it exactly once after reconnect, and nothing
 * client-side ever replays a send on its own. Notifies subscribers so the
 * viewing composer shows the message as queued.
 */
export function stashUndeliverableChatSend(frame: Record<string, unknown>): void {
  const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : null;
  const content = typeof frame.content === 'string' ? frame.content : '';
  const options = frame.options && typeof frame.options === 'object' && !Array.isArray(frame.options)
    ? { ...(frame.options as Record<string, unknown>) }
    : {};
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  delete options.attachments;
  if (!sessionId || (!content.trim() && attachments.length === 0)) {
    return;
  }
  writeQueuedMessage(sessionId, { content, options, attachments });
  notify(sessionId);
}

export function clearQueuedMessage(sessionId: string): void {
  if (!cache.has(sessionId)) {
    return;
  }
  cache.delete(sessionId);
  pendingWrites.delete(sessionId);
  void enqueue(sessionId, () =>
    authenticatedFetch(endpoint(sessionId), {
      method: 'DELETE',
      body: JSON.stringify({ clientId: queuedClientId }),
    }).catch(() => {
      // Transient network failure; the next hydrate reconciles.
    }),
  );
}

/**
 * Atomically pops the session's queued message: resolves the removed server
 * row for the one client whose delete claimed it, null for everyone else.
 * Every sender (the viewing composer on any device, the app-level auto-send)
 * claims before sending and sends the popped copy, so a message queued on one
 * device and visible on three is sent exactly once — and always with the
 * server's content, never a stale local copy (ui12 phase 1).
 */
export function claimQueuedMessage(sessionId: string): Promise<StoredQueuedMessage | null> {
  cache.delete(sessionId);
  pendingWrites.delete(sessionId);
  return enqueue(sessionId, async () => {
    try {
      const response = await authenticatedFetch(endpoint(sessionId), {
        method: 'DELETE',
        body: JSON.stringify({ clientId: queuedClientId }),
      });
      if (!response.ok) {
        return null;
      }
      const body = await response.json();
      const message = body?.data?.message as StoredQueuedMessage | null | undefined;
      return body?.data?.claimed === true && message && typeof message.content === 'string'
        ? normalize(message)
        : null;
    } catch {
      return null;
    }
  });
}

export function applyRemoteQueuedMessage(sessionId: string, message: StoredQueuedMessage | null): void {
  if (message && typeof message.content === 'string') {
    cache.set(sessionId, normalize(message));
  } else {
    cache.delete(sessionId);
  }
  notify(sessionId);
}

const LEGACY_KEY_PREFIX = 'queued_message_';

/**
 * Messages queued by the pre-sync build sit in localStorage. They are stale by
 * definition — the server queue has been the sole truth since ui11 phase 1 —
 * so they purge without ever reaching the server or a send path: a machine
 * powered back on must never fire an old local message (ui12 phase 1).
 */
const purgeLegacyQueuedMessages = (): void => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LEGACY_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
};

export async function hydrateQueuedMessages(): Promise<void> {
  purgeLegacyQueuedMessages();
  let messages: Record<string, StoredQueuedMessage>;
  try {
    const response = await authenticatedFetch('/api/queued-messages');
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    messages = body?.data?.messages && typeof body.data.messages === 'object' ? body.data.messages : {};
  } catch {
    return;
  }
  const touched = new Set([...cache.keys(), ...Object.keys(messages)]);
  // A local write the server never acknowledged is this tab's own in-flight
  // message, not a stale remnant: keep it and re-push instead of adopting the
  // server's (missing) copy, or the message would silently evaporate.
  const unacknowledged = new Map<string, StoredQueuedMessage>();
  for (const sessionId of pendingWrites) {
    const local = cache.get(sessionId);
    if (local) {
      unacknowledged.set(sessionId, local);
    }
  }
  cache.clear();
  for (const [sessionId, message] of Object.entries(messages)) {
    if (message && typeof message.content === 'string') {
      cache.set(sessionId, normalize(message));
    }
  }
  for (const [sessionId, message] of unacknowledged) {
    cache.set(sessionId, message);
    void pushQueuedMessage(sessionId, message);
  }
  touched.forEach(notify);
}

export function getClaudeSettings(): ClaudeSettings {
  const raw = safeLocalStorage.getItem(CLAUDE_SETTINGS_KEY);
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: Boolean(parsed.skipPermissions),
      projectSortOrder: parsed.projectSortOrder || 'name',
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'name',
    };
  }
}
