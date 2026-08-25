import express from 'express';
import type { Request, Response } from 'express';

import { queuedMessagesDb } from '@/modules/database/index.js';
import { broadcastQueuedMessageUpdated, parseQueuedMessageRow } from '@/modules/queued-messages/queued-messages.shared.js';
import { filterAttachmentsToUploadStore } from '@/modules/websocket/index.js';
import { emitQueuedMessageChanged } from '@/shared/queued-message-signal.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Per-session queued messages (ui11 phase 1), following the composer-drafts
 * precedent: the composer PUTs the message when Queue is pressed, every device
 * GETs the full set at app load, and each write or claim broadcasts
 * `queued_message_updated` (message null on clear) so the card appears or
 * disappears everywhere live. `clientId` is echoed so the writing tab can
 * ignore its own update. DELETE is an atomic pop: it returns `claimed` plus
 * the popped row, and only the client whose delete removed the row sends —
 * always the popped server copy, so two devices never double-send and a stale
 * device never sends an outdated local copy (ui12 phase 1).
 *
 * Attachments are validated here, at the boundary, because the Claude runtime
 * later reads the row straight into the running turn (ui11 phase 2) without a
 * second chat.send pass.
 */

export function createQueuedMessagesRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const messages = Object.fromEntries(
        queuedMessagesDb.listAll().map((row) => [row.session_id, parseQueuedMessageRow(row)]),
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
      const attachments = filterAttachmentsToUploadStore(body.attachments);
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
      emitQueuedMessageChanged(sessionId);
      res.json(createApiSuccessResponse({ sessionId, updatedAt }));
    }),
  );

  router.delete(
    '/:sessionId',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = String(req.params.sessionId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const clientId = typeof body.clientId === 'string' ? body.clientId : null;
      const row = queuedMessagesDb.get(sessionId);
      const claimed = row !== null && queuedMessagesDb.remove(sessionId);
      if (claimed) {
        broadcastQueuedMessageUpdated(sessionId, null, clientId);
        emitQueuedMessageChanged(sessionId);
      }
      res.json(createApiSuccessResponse({ sessionId, claimed, message: claimed && row ? parseQueuedMessageRow(row) : null }));
    }),
  );

  return router;
}
