import express from 'express';
import type { Request, Response } from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import {
  addAccountToken,
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
 * behind authenticateToken. Add-account accepts the token in the request body
 * and forwards it to cswap over stdin; it is never echoed back, logged, or
 * persisted.
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

  router.post(
    '/add',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!token || /[\r\n]/.test(token)) {
        throw new AppError('token must be a single-line string.', {
          code: 'INVALID_ACCOUNT_TOKEN',
          statusCode: 400,
        });
      }
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        throw new AppError('email is not a valid address.', {
          code: 'INVALID_ACCOUNT_EMAIL',
          statusCode: 400,
        });
      }
      await addAccountToken(token, email);
      res.json(createApiSuccessResponse({ added: true }));
    }),
  );

  return router;
}
