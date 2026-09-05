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
  /** Client-generated message id; the server keys the row by it. */
  id: string;
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
  /** True until this device receives a successful server response for the row. */
  pendingReceipt?: boolean;
};

/**
 * Server-persisted queued messages (ui11 phase 1; a per-session stack since
 * ui15 job 2). The in-memory cache is the synchronous view every reader uses;
 * it is filled by `hydrateQueuedMessages` at app load, kept current by
 * `queued_message_updated` broadcasts (which carry the session's whole
 * ordered stack), and written through to `/api/queued-messages` on every
 * local change. Network calls are serialized per session so a write never
 * overtakes its clear.
 */

export const queuedClientId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const createQueuedMessageId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const cache = new Map<string, StoredQueuedMessage[]>();
const listeners = new Set<(sessionId: string) => void>();
const tails = new Map<string, Promise<unknown>>();

const CHAT_SEND_OUTBOX_KEY = 'chat_send_outbox_v1';

type OutboxEntry = {
  sessionId: string;
  message: StoredQueuedMessage;
};

/**
 * Message ids whose latest local write has not been acknowledged by the
 * server. The matching payloads live in the device-local outbox below, so a
 * reload can restore and re-push them with the same idempotency key.
 */
const pendingWrites = new Map<string, Set<string>>();
let outbox: OutboxEntry[] = [];

const notify = (sessionId: string) => {
  listeners.forEach((listener) => listener(sessionId));
};

const enqueue = <T>(sessionId: string, operation: () => Promise<T>): Promise<T> => {
  const next = (tails.get(sessionId) ?? Promise.resolve()).then(operation, operation);
  tails.set(sessionId, next);
  return next;
};

const normalize = (message: StoredQueuedMessage): StoredQueuedMessage => ({
  id: message.id || createQueuedMessageId(),
  content: message.content,
  options: message.options,
  attachments: message.attachments ?? message.images ?? [],
});

const hasSubstance = (message: StoredQueuedMessage): boolean =>
  Boolean(message.content.trim()) || (message.attachments?.length ?? 0) > 0;

const persistOutbox = (): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (outbox.length === 0) {
    safeLocalStorage.removeItem(CHAT_SEND_OUTBOX_KEY);
    return;
  }
  safeLocalStorage.setItem(CHAT_SEND_OUTBOX_KEY, JSON.stringify(outbox));
};

const loadOutbox = (): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const raw = safeLocalStorage.getItem(CHAT_SEND_OUTBOX_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return;
    }
    outbox = parsed.flatMap((candidate): OutboxEntry[] => {
      if (!candidate || typeof candidate !== 'object') {
        return [];
      }
      const entry = candidate as Partial<OutboxEntry>;
      if (typeof entry.sessionId !== 'string' || !entry.message || typeof entry.message.content !== 'string') {
        return [];
      }
      const message = normalize(entry.message);
      return hasSubstance(message) ? [{ sessionId: entry.sessionId, message }] : [];
    });
  } catch {
    outbox = [];
    safeLocalStorage.removeItem(CHAT_SEND_OUTBOX_KEY);
  }

  for (const { sessionId, message } of outbox) {
    (pendingWrites.get(sessionId) ?? pendingWrites.set(sessionId, new Set()).get(sessionId)!).add(message.id);
    const list = cache.get(sessionId) ?? [];
    const index = list.findIndex((candidate) => candidate.id === message.id);
    cache.set(
      sessionId,
      index >= 0
        ? list.map((candidate, currentIndex) => (currentIndex === index ? message : candidate))
        : [...list, message],
    );
  }
};

const rememberPendingWrite = (sessionId: string, message: StoredQueuedMessage): void => {
  (pendingWrites.get(sessionId) ?? pendingWrites.set(sessionId, new Set()).get(sessionId)!).add(message.id);
  const index = outbox.findIndex((entry) => entry.sessionId === sessionId && entry.message.id === message.id);
  if (index >= 0) {
    outbox[index] = { sessionId, message };
  } else {
    outbox.push({ sessionId, message });
  }
  persistOutbox();
};

loadOutbox();

const endpoint = (sessionId: string, id?: string) =>
  `/api/queued-messages/${encodeURIComponent(sessionId)}${id ? `/${encodeURIComponent(id)}` : ''}`;

const clearPendingWrite = (sessionId: string, id: string) => {
  const ids = pendingWrites.get(sessionId);
  if (ids) {
    ids.delete(id);
    if (ids.size === 0) {
      pendingWrites.delete(sessionId);
    }
  }
  const nextOutbox = outbox.filter((entry) => entry.sessionId !== sessionId || entry.message.id !== id);
  if (nextOutbox.length !== outbox.length) {
    outbox = nextOutbox;
    persistOutbox();
  }
};

/** Notified when another device (or hydration) changes a session's queued stack. */
export function subscribeQueuedMessages(listener: (sessionId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session's queued messages in delivery order. */
export function readQueuedMessages(sessionId: string): StoredQueuedMessage[] {
  const pendingIds = pendingWrites.get(sessionId);
  return (cache.get(sessionId) ?? [])
    .filter(hasSubstance)
    .map((message) => ({ ...message, pendingReceipt: pendingIds?.has(message.id) ?? false }));
}

const pushQueuedMessage = (sessionId: string, message: StoredQueuedMessage): Promise<unknown> =>
  enqueue(sessionId, () =>
    authenticatedFetch(endpoint(sessionId, message.id), {
      method: 'PUT',
      body: JSON.stringify({ ...message, clientId: queuedClientId }),
    }).then((response) => {
      if (response.ok) {
        clearPendingWrite(sessionId, message.id);
        notify(sessionId);
      }
    }).catch(() => {
      // Stays in pendingWrites; the next hydrate re-pushes it.
    }),
  );

/** Appends a new queued message, or updates the one already holding its id in place. */
export function writeQueuedMessage(sessionId: string, message: StoredQueuedMessage): void {
  const normalized = normalize(message);
  const list = cache.get(sessionId) ?? [];
  const index = list.findIndex((candidate) => candidate.id === normalized.id);
  const next = index >= 0
    ? list.map((candidate, currentIndex) => (currentIndex === index ? normalized : candidate))
    : [...list, normalized];
  cache.set(sessionId, next);
  rememberPendingWrite(sessionId, normalized);
  notify(sessionId);
  void pushQueuedMessage(sessionId, normalized);
}

/**
 * A chat.send frame that found the socket dead lands in the device-local
 * outbox first. Its server-queue PUT keeps retrying with the same idempotency
 * key until acknowledged, after which the composer flush and app-level
 * auto-send deliver the server row exactly once.
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
  writeQueuedMessage(sessionId, { id: createQueuedMessageId(), content, options, attachments });
}

/** Deletes one queued message everywhere (card delete); no send follows. */
export function clearQueuedMessage(sessionId: string, id: string): void {
  const list = cache.get(sessionId);
  if (!list?.some((candidate) => candidate.id === id)) {
    return;
  }
  cache.set(sessionId, list.filter((candidate) => candidate.id !== id));
  clearPendingWrite(sessionId, id);
  void enqueue(sessionId, () =>
    authenticatedFetch(endpoint(sessionId, id), {
      method: 'DELETE',
      body: JSON.stringify({ clientId: queuedClientId }),
    }).catch(() => {
      // Transient network failure; the next hydrate reconciles.
    }),
  );
}

/**
 * The server already claimed this message (the runtime steered it into the
 * running turn) and its user bubble just landed: drop the local copy in the
 * same event so the card clears in the same frame as the bubble (ui15 job 2).
 * No network call — the row is already gone.
 */
export function settleQueuedMessageDelivered(sessionId: string, id: string): void {
  const list = cache.get(sessionId);
  if (!list?.some((candidate) => candidate.id === id)) {
    return;
  }
  cache.set(sessionId, list.filter((candidate) => candidate.id !== id));
  clearPendingWrite(sessionId, id);
  notify(sessionId);
}

/**
 * Atomically pops the session's next queued message: resolves the removed
 * server row for the one client whose delete claimed it, null for everyone
 * else. Every sender (the viewing composer on any device, the app-level
 * auto-send) claims before sending and sends the popped copy, so a message
 * queued on one device and visible on three is sent exactly once — and always
 * with the server's content, never a stale local copy (ui12 phase 1).
 */
export function claimNextQueuedMessage(sessionId: string): Promise<StoredQueuedMessage | null> {
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
      if (body?.data?.claimed !== true || !message || typeof message.content !== 'string') {
        return null;
      }
      const normalized = normalize(message);
      const list = cache.get(sessionId);
      if (list) {
        cache.set(sessionId, list.filter((candidate) => candidate.id !== normalized.id));
      }
      clearPendingWrite(sessionId, normalized.id);
      return normalized;
    } catch {
      return null;
    }
  });
}

export function applyRemoteQueuedMessages(sessionId: string, messages: StoredQueuedMessage[]): void {
  const normalized = messages
    .filter((message) => message && typeof message.content === 'string')
    .map(normalize);
  const localPending = outbox
    .filter((entry) => entry.sessionId === sessionId)
    .map((entry) => entry.message);
  for (const message of localPending) {
    if (!normalized.some((candidate) => candidate.id === message.id)) {
      normalized.push(message);
    }
  }
  if (normalized.length > 0) {
    cache.set(sessionId, normalized);
  } else {
    cache.delete(sessionId);
  }
  notify(sessionId);
}

const LEGACY_KEY_PREFIX = 'queued_message_';

/**
 * Messages queued by the pre-sync build use a different key shape and lack an
 * idempotency key, so they remain unsafe to replay and are purged. The current
 * CHAT_SEND_OUTBOX_KEY is retained until the server acknowledges each row.
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
  let messages: Record<string, StoredQueuedMessage[]>;
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
  // Reconcile server truth first, then replay the durable outbox in its saved
  // order. Per-session request tails preserve that order through the PUTs.
  const unacknowledged = [...outbox];
  cache.clear();
  for (const [sessionId, sessionMessages] of Object.entries(messages)) {
    if (Array.isArray(sessionMessages)) {
      const normalized = sessionMessages
        .filter((message) => message && typeof message.content === 'string')
        .map(normalize);
      if (normalized.length > 0) {
        cache.set(sessionId, normalized);
      }
    }
  }
  for (const { sessionId, message } of unacknowledged) {
    const list = cache.get(sessionId) ?? [];
    if (!list.some((candidate) => candidate.id === message.id)) {
      list.push(message);
    }
    cache.set(sessionId, list);
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
