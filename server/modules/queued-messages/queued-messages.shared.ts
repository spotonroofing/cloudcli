import type { QueuedMessageRow } from '@/modules/database/index.js';
import { queuedMessagesDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

/**
 * Row parsing and the `queued_message_updated` broadcast, shared by the REST
 * routes and the Claude runtime (which claims a session's queued message
 * mid-turn and has to clear the card on every device the same way a client
 * claim does). Since ui15 job 2 the broadcast carries the session's whole
 * ordered stack, so every device mirrors the same list after any change.
 */

const parseJsonArray = (json: string | null): unknown[] => {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (json: string | null): Record<string, unknown> | undefined => {
  if (!json) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export type QueuedMessagePayload = {
  id: string;
  content: string;
  options: Record<string, unknown> | undefined;
  attachments: unknown[];
  updatedAt: string;
};

export const parseQueuedMessageRow = (row: QueuedMessageRow): QueuedMessagePayload => ({
  id: row.id,
  content: row.content,
  options: parseJsonObject(row.options_json),
  attachments: parseJsonArray(row.attachments_json),
  updatedAt: row.updated_at,
});

export const listQueuedMessagePayloads = (sessionId: string): QueuedMessagePayload[] =>
  queuedMessagesDb.listForSession(sessionId).map(parseQueuedMessageRow);

export const broadcastQueuedMessagesUpdated = (
  sessionId: string,
  messages: QueuedMessagePayload[],
  clientId: string | null,
): void => {
  const payload = JSON.stringify({ kind: 'queued_message_updated', sessionId, messages, clientId });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
};
