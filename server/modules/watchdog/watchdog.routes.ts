import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { apiKeysDb, sessionsDb } from '@/modules/database/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { parseManifest, watchdogService } from './watchdog.service.js';

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
      watchdogService.registerChain({ slug, projectPath, phases, manifest: parseManifest(body.manifest) });
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

  // The dispatch runner announces each phase's session id before launching
  // the phase, so the row exists tagged origin 'dispatch' (with its chain
  // slug) before transcript discovery can index it untagged. The upsert path
  // in setSessionOrigin creates the row when discovery has not seen it yet.
  router.post(
    '/chains/:slug/sessions',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!sessionId || !projectPath) {
        throw new AppError('sessionId and projectPath are required.', {
          code: 'WATCHDOG_CHAIN_SESSION_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const provider = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'claude';
      const baseCommit = typeof body.baseCommit === 'string' && body.baseCommit.trim() ? body.baseCommit.trim() : null;
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
      const phase = Number.isFinite(Number(body.phase)) ? Number(body.phase) : null;
      sessionsDb.setSessionOrigin(sessionId, 'dispatch', baseCommit, slug, model, { provider, projectPath }, phase);
      res.status(201).json(createApiSuccessResponse({ slug, sessionId }));
    }),
  );

  // Queue additional work onto an active chain (ui9 B4 append): the manifest
  // grows here immediately so the navigator updates live; the runner picks the
  // queued prompt files up at the current phase's commit gate.
  router.post(
    '/chains/:slug/append',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entries = parseManifest(body.entries);
      if (!entries) {
        throw new AppError('entries must be a non-empty array of {name, tasks?, kind?}.', {
          code: 'WATCHDOG_APPEND_ENTRIES_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      if (!watchdogService.appendToChain(slug, entries)) {
        throw new AppError(`Chain "${slug}" is not registered or not running.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.status(201).json(createApiSuccessResponse({ slug, appended: entries.length }));
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
