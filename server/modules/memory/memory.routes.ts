import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import express from 'express';
import type { Request, Response } from 'express';

import { memoryUpdatesDb, projectsDb } from '@/modules/database/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { GLOBAL_MEMORY_DIR, PLANNER_MEMORY_ROOT } from './memory.service.js';

/**
 * Read-only memory API (ui12 phase 7): the per-session memory-updated rows the
 * transcript merges on reload, plus the memory viewer's file listings for a
 * project's planner memory and the cross-project `planner/_global/` folder.
 */

type MemoryFileEntry = { name: string; content: string };

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Reads every markdown file in one directory, alphabetical by name. */
async function readMarkdownDir(dirPath: string): Promise<MemoryFileEntry[]> {
  let names: string[];
  try {
    names = await fsPromises.readdir(dirPath);
  } catch {
    return [];
  }
  const entries: MemoryFileEntry[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    const content = await readFileOrNull(path.join(dirPath, name));
    if (content !== null) {
      entries.push({ name, content });
    }
  }
  return entries;
}

function parseFiles(filesJson: string): string[] {
  try {
    const parsed = JSON.parse(filesJson);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
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
            files: parseFiles(row.files_json),
            createdAt: row.created_at,
          })),
        }),
      );
    }),
  );

  router.get(
    '/project/:projectId',
    asyncHandler(async (req: Request, res: Response) => {
      const projectPath = projectsDb.getProjectPathById(String(req.params.projectId));
      if (!projectPath) {
        throw new AppError('Project not found.', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
      }
      const memoryName = projectsDb.getPlannerMemoryName(projectPath)?.trim()
        || path.basename(projectPath);
      const memoryDir = path.join(PLANNER_MEMORY_ROOT, memoryName);

      const [projectMd, stateMd, lessons, sessionSummaries] = await Promise.all([
        readFileOrNull(path.join(memoryDir, 'PROJECT.md')),
        readFileOrNull(path.join(memoryDir, 'STATE.md')),
        readMarkdownDir(path.join(memoryDir, 'lessons')),
        readMarkdownDir(path.join(memoryDir, 'sessions')),
      ]);

      res.json(
        createApiSuccessResponse({
          memoryName,
          projectMd,
          stateMd,
          lessons,
          // Session summaries are date-prefixed; newest first, recent only.
          sessions: sessionSummaries.reverse().slice(0, 12),
        }),
      );
    }),
  );

  router.get(
    '/global',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse({ files: await readMarkdownDir(GLOBAL_MEMORY_DIR) }));
    }),
  );

  return router;
}
