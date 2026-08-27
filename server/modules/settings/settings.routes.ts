import express from 'express';

import { userSettingsDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

import type { ModelRole, ModelSelection, PlannerMcpServer, createSettingsService } from './settings.service.js';

const MODEL_ROLES: ModelRole[] = ['planner', 'worker'];
const MODEL_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'];

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

  router.get('/watchdog', respond(() => ({ success: true, ...service.getWatchdogSettings() })));
  router.put('/watchdog', respond((req) => {
    const body = (req.body ?? {}) as { settings?: unknown; plannerRotationThreshold?: unknown };
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      throw new AppError('settings must be an object.', {
        code: 'WATCHDOG_SETTINGS_REQUIRED',
        statusCode: 400,
      });
    }
    const current = service.getWatchdogSettings().settings;
    const settings: Partial<Record<keyof typeof current, boolean>> = {};
    for (const [key, value] of Object.entries(body.settings as Record<string, unknown>)) {
      if (!(key in current) || typeof value !== 'boolean') {
        throw new AppError(`Invalid watchdog setting "${key}".`, {
          code: 'WATCHDOG_SETTING_INVALID',
          statusCode: 400,
        });
      }
      settings[key as keyof typeof current] = value;
    }
    const rawThreshold = body.plannerRotationThreshold;
    const threshold = rawThreshold === undefined ? undefined : Number(rawThreshold);
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 5 || threshold > 95)) {
      throw new AppError('plannerRotationThreshold must be between 5 and 95.', {
        code: 'WATCHDOG_ROTATION_THRESHOLD_INVALID',
        statusCode: 400,
      });
    }
    return {
      success: true,
      ...service.updateWatchdogSettings(settings, threshold === undefined ? undefined : Math.round(threshold)),
    };
  }));

  // Models section: per-role model and effort defaults. The dispatch CLI and
  // the spawn paths read the same store this GET serves.
  router.get('/models', respond(() => ({ success: true, ...service.getModelDefaults() })));
  router.put('/models', respond((req) => {
    const body = (req.body ?? {}) as { roles?: unknown };
    if (!body.roles || typeof body.roles !== 'object' || Array.isArray(body.roles)) {
      throw new AppError('roles must be an object.', { code: 'MODEL_ROLES_REQUIRED', statusCode: 400 });
    }
    const roles: Partial<Record<ModelRole, ModelSelection>> = {};
    for (const [role, value] of Object.entries(body.roles as Record<string, unknown>)) {
      const selection = (value ?? {}) as Partial<ModelSelection>;
      const valid = MODEL_ROLES.includes(role as ModelRole)
        && typeof selection.provider === 'string' && MODEL_PROVIDERS.includes(selection.provider)
        && typeof selection.model === 'string' && selection.model.trim()
        && typeof selection.effort === 'string' && selection.effort.trim();
      if (!valid) {
        throw new AppError(`Invalid model default for "${role}".`, { code: 'MODEL_DEFAULT_INVALID', statusCode: 400 });
      }
      roles[role as ModelRole] = {
        provider: selection.provider as string,
        model: (selection.model as string).trim(),
        effort: (selection.effort as string).trim(),
      };
    }
    return { success: true, ...service.updateModelDefaults(roles) };
  }));

  router.get('/planner-mcp', respond((req) => {
    const projectPath = queryString(req.query.projectPath);
    if (!projectPath) {
      throw new AppError('projectPath is required.', { code: 'PLANNER_MCP_PROJECT_REQUIRED', statusCode: 400 });
    }
    return { success: true, ...service.getPlannerMcpSettings(projectPath) };
  }));
  router.put('/planner-mcp', respond((req) => {
    const body = (req.body ?? {}) as { projectPath?: unknown; enabled?: unknown };
    const projectPath = queryString(body.projectPath);
    if (!projectPath || !Array.isArray(body.enabled) || !body.enabled.every((value) => typeof value === 'string')) {
      throw new AppError('projectPath and enabled server names are required.', {
        code: 'PLANNER_MCP_SETTINGS_INVALID',
        statusCode: 400,
      });
    }
    const known = service.getPlannerMcpSettings(projectPath).servers as readonly string[];
    if (body.enabled.some((server) => !known.includes(server))) {
      throw new AppError('enabled contains an unknown MCP server.', {
        code: 'PLANNER_MCP_SERVER_INVALID',
        statusCode: 400,
      });
    }
    return {
      success: true,
      ...service.updatePlannerMcpSettings(projectPath, body.enabled as PlannerMcpServer[]),
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
