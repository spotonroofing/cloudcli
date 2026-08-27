import express from 'express';
import type { Request, Response } from 'express';

import { listPromptHistory } from '@/modules/prompt-history/prompt-history.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export function createPromptHistoryRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
      const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId ? req.query.sessionId : null;
      const parsedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
      const prompts = await listPromptHistory({ projectId, sessionId, limit });
      res.json(createApiSuccessResponse({ prompts }));
    }),
  );

  return router;
}
