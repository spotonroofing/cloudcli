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

export function writeQueuedMessage(sessionId: string, message: StoredQueuedMessage): void {
  const normalized = normalize(message);
  const previous = cache.get(sessionId);
  if (previous && serialize(previous) === serialize(normalized)) {
    return;
  }
  cache.set(sessionId, normalized);
  void enqueue(sessionId, () =>
    authenticatedFetch(endpoint(sessionId), {
      method: 'PUT',
      body: JSON.stringify({ ...normalized, clientId: queuedClientId }),
    }).catch(() => {
      // Transient network failure; the next hydrate reconciles.
    }),
  );
}

export function clearQueuedMessage(sessionId: string): void {
  if (!cache.has(sessionId)) {
    return;
  }
  cache.delete(sessionId);
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
 * Removes the session's queued message and resolves true only for the one
 * client whose delete removed the server row. Every sender (the viewing
 * composer on any device, the app-level auto-send) claims before sending, so
 * a message queued on one device and visible on three is sent exactly once.
 */
export function claimQueuedMessage(sessionId: string): Promise<boolean> {
  cache.delete(sessionId);
  return enqueue(sessionId, async () => {
    try {
      const response = await authenticatedFetch(endpoint(sessionId), {
        method: 'DELETE',
        body: JSON.stringify({ clientId: queuedClientId }),
      });
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      return body?.data?.claimed === true;
    } catch {
      return false;
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

/** Messages queued by the pre-sync build sit in localStorage; move them up once. */
const migrateLegacyQueuedMessages = (): void => {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(LEGACY_KEY_PREFIX)) {
      continue;
    }
    const sessionId = key.slice(LEGACY_KEY_PREFIX.length);
    const raw = localStorage.getItem(key) ?? '';
    localStorage.removeItem(key);
    if (cache.has(sessionId)) {
      continue;
    }
    let message: StoredQueuedMessage | null = null;
    try {
      const parsed = JSON.parse(raw) as StoredQueuedMessage;
      message = parsed && typeof parsed.content === 'string' ? parsed : null;
    } catch {
      message = raw.trim() ? { content: raw } : null;
    }
    if (message && (message.content.trim() || (message.attachments ?? message.images ?? []).length > 0)) {
      writeQueuedMessage(sessionId, message);
    }
  }
};

export async function hydrateQueuedMessages(): Promise<void> {
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
  cache.clear();
  for (const [sessionId, message] of Object.entries(messages)) {
    if (message && typeof message.content === 'string') {
      cache.set(sessionId, normalize(message));
    }
  }
  migrateLegacyQueuedMessages();
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
