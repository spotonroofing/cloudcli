import express from 'express';
import type { Request, Response } from 'express';

import { composerDraftsDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/**
 * Per-session composer drafts (ui8 phase 2): the composer PUTs text +
 * uploaded-attachment descriptors as the user types, every device GETs the
 * draft when a session opens, and each write broadcasts `draft_updated` to all
 * connected clients so a draft started on one device appears on the others
 * within the debounce window. `clientId` is echoed back so the writing tab can
 * ignore its own update.
 */

const broadcastDraftUpdated = (
  draftKey: string,
  content: string,
  attachments: unknown[],
  updatedAt: string,
  clientId: string | null,
) => {
  const payload = JSON.stringify({
    kind: 'draft_updated',
    draftKey,
    content,
    attachments,
    updatedAt,
    clientId,
  });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
};

const parseAttachments = (attachmentsJson: string | null): unknown[] => {
  if (!attachmentsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(attachmentsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function createDraftsRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/:draftKey',
    asyncHandler(async (req: Request, res: Response) => {
      const row = composerDraftsDb.getDraft(String(req.params.draftKey));
      res.json(
        createApiSuccessResponse({
          draft: row
            ? {
                content: row.content,
                attachments: parseAttachments(row.attachments_json),
                updatedAt: row.updated_at,
              }
            : null,
        }),
      );
    }),
  );

  router.put(
    '/:draftKey',
    asyncHandler(async (req: Request, res: Response) => {
      const draftKey = String(req.params.draftKey);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.content !== 'string') {
        throw new AppError('content must be a string.', {
          code: 'DRAFT_CONTENT_REQUIRED',
          statusCode: 400,
        });
      }
      const content = body.content;
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const clientId = typeof body.clientId === 'string' ? body.clientId : null;
      const updatedAt = new Date().toISOString();

      // An empty draft is a deletion — sending or clearing the composer
      // removes the row instead of accumulating blank records.
      if (!content.trim() && attachments.length === 0) {
        composerDraftsDb.deleteDraft(draftKey);
      } else {
        composerDraftsDb.upsertDraft(
          draftKey,
          content,
          attachments.length > 0 ? JSON.stringify(attachments) : null,
          updatedAt,
        );
      }

      broadcastDraftUpdated(draftKey, content, attachments, updatedAt, clientId);
      res.json(createApiSuccessResponse({ draftKey, updatedAt }));
    }),
  );

  return router;
}
