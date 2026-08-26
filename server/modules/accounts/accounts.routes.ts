import express from 'express';
import type { Request, Response } from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import {
  assertAccountTarget,
  disableAccount,
  enableAccount,
  getAccountStatus,
  listAccounts,
  swapAccounts,
  switchAccount,
} from './accounts.service.js';

/**
 * Claude account switcher endpoints (ui8 phase 6), wrapping cswap. Mounted
 * behind authenticateToken. There is no add endpoint: accounts are added by
 * logging in and running `cswap add` in a shell (ui14 job 4).
 */
export function createAccountsRouter(): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse(await listAccounts()));
    }),
  );

  router.get(
    '/status',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse(await getAccountStatus()));
    }),
  );

  router.post(
    '/switch',
    asyncHandler(async (req: Request, res: Response) => {
      const target = assertAccountTarget((req.body ?? {}).target);
      const { result, mirrored } = await switchAccount(target);
      res.json(createApiSuccessResponse({ result, mirrored }));
    }),
  );

  router.post(
    '/disable',
    asyncHandler(async (req: Request, res: Response) => {
      const target = assertAccountTarget((req.body ?? {}).target);
      await disableAccount(target);
      res.json(createApiSuccessResponse({ target }));
    }),
  );

  router.post(
    '/enable',
    asyncHandler(async (req: Request, res: Response) => {
      const target = assertAccountTarget((req.body ?? {}).target);
      await enableAccount(target);
      res.json(createApiSuccessResponse({ target }));
    }),
  );

  router.post(
    '/swap',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const a = assertAccountTarget(body.a);
      const b = assertAccountTarget(body.b);
      await swapAccounts(a, b);
      res.json(createApiSuccessResponse({ a, b }));
    }),
  );

  return router;
}
