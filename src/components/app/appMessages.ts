/**
 * The app's one failure channel (audit1 job 8). Every user-initiated action
 * that can fail — a model or effort switch, chain fast mode, a chain control,
 * a settings save, the search stream, the jobs load, memory, push subscribe —
 * reports here instead of writing to a console Willem never opens. The store
 * is plain data so the surface stays testable without a DOM.
 */

export type AppMessage = {
  /** Stable per source: a repeat of the same failure replaces its entry. */
  id: string;
  title: string;
  detail: string | null;
  /** Present only where retrying the same action makes sense. */
  retry?: (() => void | Promise<void>) | null;
  retryLabel?: string | null;
};

/** Three at once is the ceiling; older entries fall off the top. */
export const MAX_APP_MESSAGES = 3;

/** Turns a thrown value into one readable line, never an empty string. */
export const failureDetail = (error: unknown): string | null => {
  if (error == null) return null;
  const text = error instanceof Error ? error.message : String(error);
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
};

/**
 * The reason a failed API call gives back: the server's own `error` string
 * where there is one, else the status line. Never the raw body.
 */
export const responseFailureDetail = async (response: {
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}): Promise<string> => {
  try {
    const body = (await response.json?.()) as { error?: unknown; message?: unknown } | undefined;
    const reason = typeof body?.error === 'string'
      ? body.error
      : typeof body?.message === 'string' ? body.message : '';
    if (reason.trim()) {
      return reason.trim();
    }
  } catch {
    // A non-JSON body falls through to the status line.
  }
  const statusText = response.statusText?.trim();
  return statusText ? `${response.status} ${statusText}` : `HTTP ${response.status}`;
};

/** Adds or replaces one message, keeping the newest MAX_APP_MESSAGES. */
export const addAppMessage = (messages: AppMessage[], message: AppMessage): AppMessage[] => {
  const existing = messages.findIndex((entry) => entry.id === message.id);
  if (existing >= 0) {
    const next = [...messages];
    next[existing] = message;
    return next;
  }
  return [...messages, message].slice(-MAX_APP_MESSAGES);
};

export const dismissAppMessage = (messages: AppMessage[], id: string): AppMessage[] =>
  messages.filter((entry) => entry.id !== id);
