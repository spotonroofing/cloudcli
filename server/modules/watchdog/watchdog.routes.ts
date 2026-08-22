import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { apiKeysDb } from '@/modules/database/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { watchdogService } from './watchdog.service.js';

/**
 * Watchdog surface (spec B3/B4): the dispatch CLI registers chains and posts
 * boundary events here, and the planner fires verified-done through /notify.
 * Accepts either a UI-minted API key (x-api-key, the dispatch CLI's lane) or
 * an already-authenticated JWT request (the authenticateToken middleware runs
 * upstream for /api routes mounted behind it).
 */
const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKeysDb.validateApiKey(apiKey)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Valid x-api-key required' });
};

export function createWatchdogRouter(): express.Router {
  const router = express.Router();

  router.post(
    '/chains',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!slug || !projectPath) {
        throw new AppError('slug and projectPath are required.', {
          code: 'WATCHDOG_CHAIN_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      const phases = Number.isFinite(Number(body.phases)) ? Number(body.phases) : null;
      watchdogService.registerChain({ slug, projectPath, phases });
      res.status(201).json(createApiSuccessResponse({ slug }));
    }),
  );

  router.post(
    '/chains/:slug/events',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const event = typeof body.event === 'string' ? body.event : '';
      if (!['phase-start', 'phase-end', 'completed', 'stopped', 'failed'].includes(event)) {
        throw new AppError('event must be phase-start|phase-end|completed|stopped|failed.', {
          code: 'WATCHDOG_EVENT_INVALID',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const detail = {
        phase: Number.isFinite(Number(body.phase)) ? Number(body.phase) : undefined,
        summaryTail: typeof body.summaryTail === 'string' ? body.summaryTail : undefined,
      };
      const eventName = event as 'phase-start' | 'phase-end' | 'completed' | 'stopped' | 'failed';
      let known = watchdogService.chainEvent(slug, eventName, detail);
      // Chains run out-of-process and outlive server restarts; a restart
      // empties the in-memory registry. Events carry projectPath so the chain
      // re-registers itself here instead of losing its planner wake to a 404.
      if (!known) {
        const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
        if (projectPath) {
          watchdogService.registerChain({
            slug,
            projectPath,
            phases: Number.isFinite(Number(body.phases)) ? Number(body.phases) : null,
          });
          known = watchdogService.chainEvent(slug, eventName, detail);
        }
      }
      if (!known) {
        throw new AppError(`Chain "${req.params.slug}" is not registered.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.json(createApiSuccessResponse({ slug: req.params.slug, event }));
    }),
  );

  // The two fleet notification kinds; the planner's verified-done endpoint.
  router.post(
    '/notify',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kind = body.kind === 'decision-needed' || body.kind === 'verified-done' ? body.kind : null;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const message = typeof body.body === 'string' ? body.body.trim() : '';
      if (!kind || !title) {
        throw new AppError('kind (decision-needed|verified-done) and title are required.', {
          code: 'WATCHDOG_NOTIFY_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      watchdogService.notify(kind, title, message);
      res.json(createApiSuccessResponse({ kind, title }));
    }),
  );

  // Manual trigger for the Monday self-maintenance run (spec B9 done-check).
  // ?classifyOnly=1 journals classifications without applying anything.
  router.post(
    '/maintenance/run',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const classifyOnly = req.query.classifyOnly === '1' || (req.body as { classifyOnly?: boolean } | undefined)?.classifyOnly === true;
      const result = await watchdogService.runMaintenance(classifyOnly);
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.get(
    '/status',
    requireApiKey,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse(watchdogService.status()));
    }),
  );

  return router;
}
