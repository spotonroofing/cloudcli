import { AppError } from '@/shared/utils.js';

type NotificationPreferences = Record<string, unknown> & {
  channels?: Record<string, unknown> & { webPush?: boolean };
};

type SettingsDependencies = {
  appConfig: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  credentials: {
    list(userId: number, credentialType: string | null): unknown[];
    create(
      userId: number,
      name: string,
      type: string,
      value: string,
      description: string | null,
    ): unknown;
    remove(userId: number, credentialId: number): boolean;
    toggle(userId: number, credentialId: number, isActive: boolean): boolean;
  };
  notifications: {
    getPreferences(userId: number): NotificationPreferences | undefined;
    updatePreferences(userId: number, preferences: NotificationPreferences): unknown;
    createEnabledEvent(): unknown;
    notifyUser(userId: number, event: unknown): void | Promise<void>;
  };
  pushSubscriptions: {
    save(userId: number, endpoint: string, p256dh: string, auth: string): void;
    remove(endpoint: string): void;
    has(userId: number, endpoint: string): boolean;
  };
  getVapidPublicKey(): string | null;
};

const WATCHDOG_DEFAULTS = {
  plannerRotation: false,
  terminalWakes: false,
  livenessSweep: true,
  dispatchRunLiveness: true,
  resourceAlerts: true,
  weeklySelfTest: true,
  weeklyMaintenance: false,
  handoffAutomation: false,
  punchlistWatching: true,
  recoveryNotices: true,
} as const;

type WatchdogBehavior = keyof typeof WATCHDOG_DEFAULTS;

const watchdogSettingKey = (behavior: WatchdogBehavior): string =>
  `watchdog_${behavior.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;

function requiredString(value: unknown, fieldName: string, code: string): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    throw new AppError(`${fieldName} is required`, { code, statusCode: 400 });
  }
  return normalizedValue;
}

function assertFound(found: boolean, resourceName: string, code: string): void {
  if (!found) {
    throw new AppError(`${resourceName} not found`, { code, statusCode: 404 });
  }
}

/** Creates settings workflows with repositories and notification effects injected. */
export function createSettingsService(dependencies: SettingsDependencies) {
  return {
    /** Watchdog module reads the stored automation policy before acting. */
    isWatchdogBehaviorEnabled(behavior: WatchdogBehavior): boolean {
      const stored = dependencies.appConfig.get(watchdogSettingKey(behavior));
      return stored === null ? WATCHDOG_DEFAULTS[behavior] : stored === '1';
    },
    /** Settings System tab reads every behavior and its explicit default. */
    getWatchdogSettings() {
      const settings = Object.fromEntries(
        (Object.keys(WATCHDOG_DEFAULTS) as WatchdogBehavior[]).map((behavior) => [
          behavior,
          this.isWatchdogBehaviorEnabled(behavior),
        ]),
      ) as Record<WatchdogBehavior, boolean>;
      return {
        settings,
        defaults: WATCHDOG_DEFAULTS,
        plannerRotationThreshold: Number(dependencies.appConfig.get('planner_rotation_threshold') ?? 60),
      };
    },
    /** Settings route persists only values Willem explicitly changed. */
    updateWatchdogSettings(
      settings: Partial<Record<WatchdogBehavior, boolean>>,
      plannerRotationThreshold?: number,
    ) {
      for (const [behavior, enabled] of Object.entries(settings) as [WatchdogBehavior, boolean][]) {
        dependencies.appConfig.set(watchdogSettingKey(behavior), enabled ? '1' : '0');
      }
      if (plannerRotationThreshold !== undefined) {
        dependencies.appConfig.set('planner_rotation_threshold', String(plannerRotationThreshold));
      }
      return this.getWatchdogSettings();
    },
    listCredentials(userId: number, credentialType: string | null) {
      return { credentials: dependencies.credentials.list(userId, credentialType) };
    },
    createCredential(userId: number, input: Record<string, unknown>) {
      const credentialName = requiredString(
        input.credentialName,
        'Credential name',
        'CREDENTIAL_NAME_REQUIRED',
      );
      const credentialType = requiredString(
        input.credentialType,
        'Credential type',
        'CREDENTIAL_TYPE_REQUIRED',
      );
      const credentialValue = requiredString(
        input.credentialValue,
        'Credential value',
        'CREDENTIAL_VALUE_REQUIRED',
      );
      const description = typeof input.description === 'string'
        ? input.description.trim() || null
        : null;
      return {
        success: true,
        credential: dependencies.credentials.create(
          userId,
          credentialName,
          credentialType,
          credentialValue,
          description,
        ),
      };
    },
    deleteCredential(userId: number, credentialId: number) {
      assertFound(
        dependencies.credentials.remove(userId, credentialId),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    toggleCredential(userId: number, credentialId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.credentials.toggle(userId, credentialId, isActive),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    getNotificationPreferences(userId: number) {
      return { success: true, preferences: dependencies.notifications.getPreferences(userId) };
    },
    updateNotificationPreferences(userId: number, preferences: NotificationPreferences) {
      return {
        success: true,
        preferences: dependencies.notifications.updatePreferences(userId, preferences),
      };
    },
    getVapidPublicKey() {
      return { publicKey: dependencies.getVapidPublicKey() };
    },
    subscribeToPush(userId: number, input: Record<string, unknown>) {
      const endpoint = requiredString(input.endpoint, 'Endpoint', 'PUSH_SUBSCRIPTION_REQUIRED');
      const keys = typeof input.keys === 'object' && input.keys !== null
        ? input.keys as Record<string, unknown>
        : {};
      const p256dh = requiredString(keys.p256dh, 'p256dh', 'PUSH_SUBSCRIPTION_REQUIRED');
      const auth = requiredString(keys.auth, 'auth', 'PUSH_SUBSCRIPTION_REQUIRED');
      dependencies.pushSubscriptions.save(userId, endpoint, p256dh, auth);

      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (!currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences?.channels, webPush: true },
        });
      }
      const event = dependencies.notifications.createEnabledEvent();
      void dependencies.notifications.notifyUser(userId, event);
      return { success: true };
    },
    getPushSubscriptionStatus(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      return { subscribed: dependencies.pushSubscriptions.has(userId, endpoint) };
    },
    unsubscribeFromPush(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      dependencies.pushSubscriptions.remove(endpoint);
      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences.channels, webPush: false },
        });
      }
      return { success: true };
    },
  };
}
