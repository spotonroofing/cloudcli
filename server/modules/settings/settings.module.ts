import {
  appConfigDb,
  credentialsDb,
  notificationPreferencesDb,
  pushSubscriptionsDb,
} from '@/modules/database/index.js';
import {
  createNotificationEvent,
  getPublicKey,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';

import { createSettingsRouter } from './settings.routes.js';
import { createSettingsService } from './settings.service.js';

/** Shared settings policy consumed by routes and watchdog automation. */
export const settingsService = createSettingsService({
  appConfig: {
    get: (key) => appConfigDb.get(key),
    set: (key, value) => appConfigDb.set(key, value),
  },
  credentials: {
    list: (userId, type) => credentialsDb.getCredentials(userId, type),
    create: (userId, name, type, value, description) =>
      credentialsDb.createCredential(userId, name, type, value, description),
    remove: (userId, credentialId) => credentialsDb.deleteCredential(userId, credentialId),
    toggle: (userId, credentialId, isActive) =>
      credentialsDb.toggleCredential(userId, credentialId, isActive),
  },
  notifications: {
    getPreferences: (userId) => notificationPreferencesDb.getPreferences(userId),
    updatePreferences: (userId, preferences) =>
      notificationPreferencesDb.updatePreferences(userId, preferences),
    createEnabledEvent: () => createNotificationEvent({
      provider: 'system', kind: 'info', code: 'push.enabled',
      meta: { message: 'Push notifications are now enabled!' }, severity: 'info',
    }),
    notifyUser: (userId, event) => notifyUserIfEnabled({ userId, event }),
  },
  pushSubscriptions: {
    save: (userId, endpoint, p256dh, auth) =>
      pushSubscriptionsDb.saveSubscription(userId, endpoint, p256dh, auth),
    remove: (endpoint) => pushSubscriptionsDb.removeSubscription(endpoint),
    has: (userId, endpoint) =>
      pushSubscriptionsDb.getSubscriptions(userId).some((sub) => sub.endpoint === endpoint),
  },
  getVapidPublicKey: getPublicKey,
});

/** Settings router assembled for the authenticated server mount. */
export const settingsRoutes = createSettingsRouter(settingsService);
