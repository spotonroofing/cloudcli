import type { QueuedMessageRow } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

/**
 * Row parsing and the `queued_message_updated` broadcast, shared by the REST
 * routes and the Claude runtime (which claims a session's queued message
 * mid-turn and has to clear the card on every device the same way a client
 * claim does).
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
  content: string;
  options: Record<string, unknown> | undefined;
  attachments: unknown[];
  updatedAt: string;
};

export const parseQueuedMessageRow = (row: QueuedMessageRow): QueuedMessagePayload => ({
  content: row.content,
  options: parseJsonObject(row.options_json),
  attachments: parseJsonArray(row.attachments_json),
  updatedAt: row.updated_at,
});

export const broadcastQueuedMessageUpdated = (
  sessionId: string,
  message: QueuedMessagePayload | null,
  clientId: string | null,
): void => {
  const payload = JSON.stringify({ kind: 'queued_message_updated', sessionId, message, clientId });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
};
