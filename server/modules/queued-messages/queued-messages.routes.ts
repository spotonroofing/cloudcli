import express from 'express';
import type { Request, Response } from 'express';

import { queuedMessagesDb, type QueuedMessageRow } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Per-session queued messages (ui11 phase 1), following the composer-drafts
 * precedent: the composer PUTs the message when Queue is pressed, every device
 * GETs the full set at app load, and each write or claim broadcasts
 * `queued_message_updated` (message null on clear) so the card appears or
 * disappears everywhere live. `clientId` is echoed so the writing tab can
 * ignore its own update. DELETE returns `claimed`: only the client whose delete
 * removed the row sends the message, so two devices never double-send.
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

const toMessage = (row: QueuedMessageRow) => ({
  content: row.content,
  options: parseJsonObject(row.options_json),
  attachments: parseJsonArray(row.attachments_json),
  updatedAt: row.updated_at,
});

const broadcastQueuedMessageUpdated = (
  sessionId: string,
  message: ReturnType<typeof toMessage> | null,
  clientId: string | null,
) => {
  const payload = JSON.stringify({ kind: 'queued_message_updated', sessionId, message, clientId });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
};

export function createQueuedMessagesRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const messages = Object.fromEntries(
        queuedMessagesDb.listAll().map((row) => [row.session_id, toMessage(row)]),
      );
      res.json(createApiSuccessResponse({ messages }));
    }),
  );

  router.put(
    '/:sessionId',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = String(req.params.sessionId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.content !== 'string') {
        throw new AppError('content must be a string.', {
          code: 'QUEUED_MESSAGE_CONTENT_REQUIRED',
          statusCode: 400,
        });
      }
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options)
        ? (body.options as Record<string, unknown>)
        : undefined;
      const clientId = typeof body.clientId === 'string' ? body.clientId : null;
      const updatedAt = new Date().toISOString();

      queuedMessagesDb.upsert(
        sessionId,
        body.content,
        options ? JSON.stringify(options) : null,
        attachments.length > 0 ? JSON.stringify(attachments) : null,
        updatedAt,
      );

      broadcastQueuedMessageUpdated(
        sessionId,
        { content: body.content, options, attachments, updatedAt },
        clientId,
      );
      res.json(createApiSuccessResponse({ sessionId, updatedAt }));
    }),
  );

  router.delete(
    '/:sessionId',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = String(req.params.sessionId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clientId = typeof body.clientId === 'string' ? body.clientId : null;
      const claimed = queuedMessagesDb.remove(sessionId);
      if (claimed) {
        broadcastQueuedMessageUpdated(sessionId, null, clientId);
      }
      res.json(createApiSuccessResponse({ sessionId, claimed }));
    }),
  );

  return router;
}
