import { promises as fsPromises } from 'node:fs';

import express from 'express';
import type { Request, Response } from 'express';

import { memoryUpdatesDb } from '@/modules/database/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { CURATED_MEMORY_PATH, editCuratedMemory } from './memory.service.js';

/**
 * Memory API (ui12 phase 7; curated-only ui14 job 3): the per-session
 * memory-updated rows the transcript merges on reload, the curated memory
 * document the Memory surface shows, and the one-off prompt edit that
 * rewrites it.
 */

const MAX_INSTRUCTION_CHARS = 4_000;

function parseJson<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

async function readCurated(): Promise<string | null> {
  try {
    return await fsPromises.readFile(CURATED_MEMORY_PATH, 'utf8');
  } catch {
    return null;
  }
}

export function createMemoryRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/sessions/:sessionId/updates',
    asyncHandler(async (req: Request, res: Response) => {
      const rows = memoryUpdatesDb.listBySession(String(req.params.sessionId));
      res.json(
        createApiSuccessResponse({
          updates: rows.map((row) => ({
            id: row.id,
            files: parseJson<string[]>(row.files_json, []).filter((entry) => typeof entry === 'string'),
            diffs: parseJson<Record<string, string[]>>(row.diffs_json, {}),
            durationMs: row.duration_ms,
            createdAt: row.created_at,
          })),
        }),
      );
    }),
  );

  router.get(
    '/curated',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse({ content: await readCurated() }));
    }),
  );

  router.post(
    '/curated/edit',
    asyncHandler(async (req: Request, res: Response) => {
      const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
      if (!instruction) {
        throw new AppError('An edit instruction is required.', { code: 'INSTRUCTION_REQUIRED', statusCode: 400 });
      }
      if (instruction.length > MAX_INSTRUCTION_CHARS) {
        throw new AppError('The instruction is too long.', { code: 'INSTRUCTION_TOO_LONG', statusCode: 400 });
      }
      const result = await editCuratedMemory(instruction);
      res.json(createApiSuccessResponse(result));
    }),
  );

  return router;
}
