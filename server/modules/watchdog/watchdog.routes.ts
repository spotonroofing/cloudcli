import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { authenticateToken } from '@/modules/auth/index.js';
import { apiKeysDb, sessionsDb } from '@/modules/database/index.js';
import { seedDispatchedClaudeContextWindow } from '@/modules/providers/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { CHAIN_EVENT_NAMES, parseJobMeta, parseManifest, watchdogService } from './watchdog.service.js';

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

/** Lets the dispatch CLI use its API key while the app uses its normal JWT. */
const requireApiKeyOrToken = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKeysDb.validateApiKey(apiKey)) {
    next();
    return;
  }
  void authenticateToken(req, res, next);
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
      const dispatchingSessionId = typeof body.dispatchingSessionId === 'string' && body.dispatchingSessionId.trim()
        ? body.dispatchingSessionId.trim()
        : null;
      // The manifest is either the bare entries array or, since ui11 phase 6,
      // an object { punchlist, entries } carrying the run's punch list path
      // (repo-relative or absolute) for per-phase done counts.
      let manifestValue: unknown = body.manifest;
      let punchlist = typeof body.punchlist === 'string' && body.punchlist.trim() ? body.punchlist.trim() : null;
      if (manifestValue && typeof manifestValue === 'object' && !Array.isArray(manifestValue)) {
        const wrapped = manifestValue as { entries?: unknown; punchlist?: unknown };
        if (typeof wrapped.punchlist === 'string' && wrapped.punchlist.trim()) {
          punchlist = wrapped.punchlist.trim();
        }
        manifestValue = wrapped.entries;
      }
      watchdogService.registerChain({
        slug,
        projectPath,
        dispatchingSessionId,
        phases,
        manifest: parseManifest(manifestValue),
        punchlist,
      });
      res.status(201).json(createApiSuccessResponse({ slug }));
    }),
  );

  router.post(
    '/chains/:slug/events',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const event = typeof body.event === 'string' ? body.event : '';
      if (!(CHAIN_EVENT_NAMES as string[]).includes(event)) {
        throw new AppError(`event must be ${CHAIN_EVENT_NAMES.join('|')}.`, {
          code: 'WATCHDOG_EVENT_INVALID',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      // phase-end carries the job's commit since ui13 job 14.
      const commitBody = body.commit as { hash?: unknown; subject?: unknown } | undefined;
      const commit = commitBody && typeof commitBody.hash === 'string' && commitBody.hash.trim()
        ? { hash: commitBody.hash.trim(), subject: typeof commitBody.subject === 'string' ? commitBody.subject.trim() : '' }
        : undefined;
      const detail = {
        phase: Number.isFinite(Number(body.phase)) ? Number(body.phase) : undefined,
        summaryTail: typeof body.summaryTail === 'string' ? body.summaryTail : undefined,
        commit,
        // A quiet limit event (codex job 2) records the wait without a planner wake.
        quiet: body.quiet === true,
        // The runner supplies this only on build phase-start. Verify events
        // never carry it and therefore can never mark a unit fast.
        fastMode: body.fastMode === true,
      };
      const eventName = event as (typeof CHAIN_EVENT_NAMES)[number];
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
            dispatchingSessionId: typeof body.dispatchingSessionId === 'string' && body.dispatchingSessionId.trim()
              ? body.dispatchingSessionId.trim()
              : null,
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

  router.get(
    '/chains/:slug/fast',
    requireApiKeyOrToken,
    asyncHandler(async (req: Request, res: Response) => {
      const slug = String(req.params.slug);
      const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath.trim() : undefined;
      const fastMode = watchdogService.chainFastMode(slug, projectPath);
      if (fastMode === null) {
        throw new AppError(`Chain "${slug}" is not registered for this project.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.json(createApiSuccessResponse({ slug, fastMode }));
    }),
  );

  router.patch(
    '/chains/:slug/fast',
    requireApiKeyOrToken,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slug = String(req.params.slug);
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!projectPath || typeof body.fastMode !== 'boolean') {
        throw new AppError('projectPath and fastMode (boolean) are required.', {
          code: 'WATCHDOG_CHAIN_FAST_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      const fastMode = watchdogService.setChainFastMode(slug, projectPath, body.fastMode);
      if (fastMode === null) {
        throw new AppError(`Chain "${slug}" is not registered for this project.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.json(createApiSuccessResponse({ slug, fastMode }));
    }),
  );

  // The dispatch runner announces each stage's session id — chosen up front
  // for Claude, the Codex thread id as soon as `codex exec` reports it — so
  // the row exists tagged origin 'dispatch' (with its chain slug, engine and
  // model) before transcript discovery can index it untagged. The upsert path
  // in setSessionOrigin creates the row when discovery has not seen it yet;
  // a Codex row is keyed by the thread id, the same key the rollout
  // synchronizer upserts on, so runner and synchronizer share one row.
  router.post(
    '/chains/:slug/sessions',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      if (!sessionId || !projectPath || !provider) {
        throw new AppError('sessionId, projectPath and provider are required.', {
          code: 'WATCHDOG_CHAIN_SESSION_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const baseCommit = typeof body.baseCommit === 'string' && body.baseCommit.trim() ? body.baseCommit.trim() : null;
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
      const phase = Number.isFinite(Number(body.phase)) ? Number(body.phase) : null;
      // The runner names the session from the prompt file's name header
      // (codex job 5): "<name>" for a build, "Verify: <name>" for a verify.
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null;
      sessionsDb.setSessionOrigin(sessionId, 'dispatch', baseCommit, slug, model, { provider, projectPath }, phase, title);
      // A headless unit never reports its own context window, so the meter
      // read a cataloged guess for the whole run (ui17 job 19).
      if (provider === 'claude') {
        seedDispatchedClaudeContextWindow(model);
      }
      // The verify stage's session (ui14 job 10) is the same row shape, tagged
      // on the chain's job metadata so the UI can tell it from the build; a
      // build announce records the unit's engine and model for the jobs column.
      if (phase != null) {
        if (body.stage === 'verify') {
          watchdogService.setChainVerifySession(slug, phase, sessionId);
        } else {
          watchdogService.setChainJobEngine(slug, phase, provider, model);
        }
      }
      res.status(201).json(createApiSuccessResponse({ slug, sessionId }));
    }),
  );

  // In-place manifest edit (ui13 job 13): replaces a chain's labels without
  // resetting its phase state the way re-registration does.
  router.patch(
    '/chains/:slug/manifest',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const entries = parseManifest(body.entries);
      if (!entries) {
        throw new AppError('entries must be a non-empty array of {name, tasks?, kind?, anchor?}.', {
          code: 'WATCHDOG_MANIFEST_ENTRIES_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      if (!watchdogService.updateChainManifest(slug, entries)) {
        throw new AppError(`Chain "${slug}" is not registered.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.json(createApiSuccessResponse({ slug, entries: entries.length }));
    }),
  );

  // Per-job commit/timing backfill (ui13 job 14): merges metadata for jobs
  // whose phase-end event passed before the runner carried commits.
  router.patch(
    '/chains/:slug/jobs',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const jobs = parseJobMeta(body.jobs);
      if (!Object.keys(jobs).length) {
        throw new AppError('jobs must map 1-based indexes to {startedAt?, endedAt?, commitHash?, commitSubject?, taskTimes?}.', {
          code: 'WATCHDOG_JOB_META_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      if (!watchdogService.updateChainJobs(slug, jobs)) {
        throw new AppError(`Chain "${slug}" is not registered.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      res.json(createApiSuccessResponse({ slug, jobs: Object.keys(jobs).length }));
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

  router.post(
    '/chains/:slug/pause',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!projectPath) {
        throw new AppError('projectPath is required.', {
          code: 'WATCHDOG_CHAIN_PROJECT_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const result = await watchdogService.requestChainPause(slug, projectPath);
      if (result === 'not-running' || result === 'no-runner') {
        throw new AppError(`Chain "${slug}" is not running.`, {
          code: 'WATCHDOG_CHAIN_NOT_RUNNING',
          statusCode: 409,
        });
      }
      if (result === 'timeout') {
        throw new AppError(`Chain "${slug}" did not finish pausing.`, {
          code: 'WATCHDOG_CHAIN_PAUSE_TIMEOUT',
          statusCode: 504,
        });
      }
      res.json(createApiSuccessResponse({ slug, status: 'paused' }));
    }),
  );

  router.post(
    '/chains/:slug/resume',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
      if (!projectPath) {
        throw new AppError('projectPath is required.', {
          code: 'WATCHDOG_CHAIN_PROJECT_REQUIRED',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const resumed = watchdogService.resumeChain(slug, projectPath);
      if (!resumed) {
        throw new AppError(`Chain "${slug}" is not paused.`, {
          code: 'WATCHDOG_CHAIN_NOT_PAUSED',
          statusCode: 409,
        });
      }
      res.json(createApiSuccessResponse({ slug, status: 'running', ...resumed }));
    }),
  );

  // Amend a queued unit's task list (ui14 job 8): the planner folds a small
  // addition into a not-yet-started job as an extra task and the jobs view
  // shows the row at once. The executing or finished unit is refused.
  router.post(
    '/chains/:slug/phases/:phase/tasks',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tasks = Array.isArray(body.tasks)
        ? body.tasks.filter((task): task is string => typeof task === 'string' && task.trim() !== '').map((task) => task.trim())
        : null;
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
      const anchor = typeof body.anchor === 'string' && body.anchor.trim() ? body.anchor.trim() : undefined;
      if (!tasks?.length && !name && !anchor) {
        throw new AppError('tasks (non-empty string array), name, or anchor is required.', {
          code: 'WATCHDOG_AMEND_FIELDS_REQUIRED',
          statusCode: 400,
        });
      }
      const phase = Number(req.params.phase);
      if (!Number.isInteger(phase) || phase < 1) {
        throw new AppError('phase must be a 1-based unit index.', {
          code: 'WATCHDOG_AMEND_PHASE_INVALID',
          statusCode: 400,
        });
      }
      const slug = String(req.params.slug);
      const result = watchdogService.amendChainPhase(slug, phase, { tasks: tasks?.length ? tasks : undefined, name, anchor });
      if (result === 'unknown') {
        throw new AppError(`Chain "${slug}" is not registered or has no manifest.`, {
          code: 'WATCHDOG_CHAIN_UNKNOWN',
          statusCode: 404,
        });
      }
      if (result === 'not-queued') {
        throw new AppError(`Unit ${phase} of chain "${slug}" is not a queued unit (already started, finished, or out of range).`, {
          code: 'WATCHDOG_AMEND_NOT_QUEUED',
          statusCode: 409,
        });
      }
      res.json(createApiSuccessResponse({ slug, phase, tasks: tasks?.length ?? undefined }));
    }),
  );

  // The two fleet notification kinds; the planner's verified-done endpoint.
  router.post(
    '/notify',
    requireApiKey,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kind = body.kind === 'decision-needed' || body.kind === 'verified-done' || body.kind === 'recovery'
        ? body.kind
        : null;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const message = typeof body.body === 'string' ? body.body.trim() : '';
      if (!kind || !title) {
        throw new AppError('kind (decision-needed|verified-done|recovery) and title are required.', {
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
