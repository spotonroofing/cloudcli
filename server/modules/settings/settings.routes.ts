import express from 'express';

import { appConfigDb } from '@/modules/database/index.js';

import type { createSettingsService } from './settings.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Creates thin Settings transport handlers around the application service. */
export function createSettingsRouter(
  service: ReturnType<typeof createSettingsService>,
): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  // Planner auto-rotation (spec B7): on/off + threshold percent against the
  // session model's real window. The watchdog sweep reads these each pass.
  router.get('/planner-rotation', respond(() => ({
    success: true,
    enabled: appConfigDb.get('planner_rotation_enabled') !== '0',
    thresholdPercent: Number(appConfigDb.get('planner_rotation_threshold') ?? 60),
  })));
  router.put('/planner-rotation', respond((req) => {
    const body = (req.body ?? {}) as { enabled?: unknown; thresholdPercent?: unknown };
    if (typeof body.enabled === 'boolean') {
      appConfigDb.set('planner_rotation_enabled', body.enabled ? '1' : '0');
    }
    const threshold = Number(body.thresholdPercent);
    if (Number.isFinite(threshold) && threshold >= 5 && threshold <= 95) {
      appConfigDb.set('planner_rotation_threshold', String(Math.round(threshold)));
    }
    return {
      success: true,
      enabled: appConfigDb.get('planner_rotation_enabled') !== '0',
      thresholdPercent: Number(appConfigDb.get('planner_rotation_threshold') ?? 60),
    };
  }));

  router.get('/api-keys', respond((req) => service.listApiKeys(userId(req))));
  router.post('/api-keys', respond((req) => service.createApiKey(userId(req), req.body?.keyName)));
  router.delete('/api-keys/:keyId', respond((req) => service.deleteApiKey(userId(req), Number(req.params.keyId))));
  router.patch('/api-keys/:keyId/toggle', respond((req) => service.toggleApiKey(
    userId(req), Number(req.params.keyId), req.body?.isActive,
  )));
  router.get('/credentials', respond((req) => service.listCredentials(
    userId(req), queryString(req.query.type),
  )));
  router.post('/credentials', respond((req) => service.createCredential(userId(req), req.body ?? {})));
  router.delete('/credentials/:credentialId', respond((req) => service.deleteCredential(
    userId(req), Number(req.params.credentialId),
  )));
  router.patch('/credentials/:credentialId/toggle', respond((req) => service.toggleCredential(
    userId(req), Number(req.params.credentialId), req.body?.isActive,
  )));
  router.get('/notification-preferences', respond((req) => service.getNotificationPreferences(userId(req))));
  router.put('/notification-preferences', respond((req) => service.updateNotificationPreferences(
    userId(req), req.body ?? {},
  )));
  router.get('/push/vapid-public-key', respond(() => service.getVapidPublicKey()));
  router.post('/push/subscribe', respond((req) => service.subscribeToPush(userId(req), req.body ?? {})));
  router.get('/push/subscription-status', respond((req) => service.getPushSubscriptionStatus(
    userId(req), req.query.endpoint,
  )));
  router.post('/push/unsubscribe', respond((req) => service.unsubscribeFromPush(
    userId(req), req.body?.endpoint,
  )));
  return router;
}
