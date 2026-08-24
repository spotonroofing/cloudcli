import express from 'express';

import { appConfigDb, userSettingsDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

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

  // Synced client preferences (ui11 phase 1): every localStorage preference the
  // client mirrors lives here per user. PUT takes a partial map (null deletes)
  // and broadcasts `settings_updated` so other devices apply it live; the
  // writing tab ignores its own echo via clientId, other users' tabs via userId.
  router.get('/preferences', respond((req) => ({
    success: true,
    settings: userSettingsDb.getAll(userId(req)),
  })));
  router.put('/preferences', respond((req) => {
    const body = (req.body ?? {}) as { settings?: unknown; clientId?: unknown };
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      throw new AppError('settings must be an object.', {
        code: 'SETTINGS_OBJECT_REQUIRED',
        statusCode: 400,
      });
    }
    const settings: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(body.settings as Record<string, unknown>)) {
      if (key.length <= 200 && (typeof value === 'string' || value === null)) {
        settings[key] = value;
      }
    }
    const id = userId(req);
    userSettingsDb.apply(id, settings, new Date().toISOString());
    const payload = JSON.stringify({
      kind: 'settings_updated',
      userId: id,
      settings,
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) {
        client.send(payload);
      }
    });
    return { success: true };
  }));

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
