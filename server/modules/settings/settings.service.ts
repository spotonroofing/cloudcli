import { AppError } from '@/shared/utils.js';

type NotificationPreferences = Record<string, unknown> & {
  channels?: Record<string, unknown> & { webPush?: boolean };
};

type SettingsDependencies = {
  appConfig: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  sessions: {
    /** Newest unarchived session of one origin in a project, excluding one id. */
    latestByOrigin(
      projectPath: string,
      origin: 'planner' | 'direct',
      excludeSessionId: string | null,
    ): { session_id: string; provider: string; model: string | null; effort: string | null } | null;
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
  terminalWakes: true,
  livenessSweep: true,
  dispatchRunLiveness: true,
  resourceAlerts: true,
  weeklySelfTest: true,
  weeklyMaintenance: true,
  punchlistWatching: true,
  recoveryNotices: true,
} as const;

export type WatchdogBehavior = keyof typeof WATCHDOG_DEFAULTS;

const watchdogSettingKey = (behavior: WatchdogBehavior): string =>
  `watchdog_${behavior.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;

/** Pre-System-tab rotation key (absent meant on); folded into watchdog_planner_rotation once. */
const LEGACY_ROTATION_KEY = 'planner_rotation_enabled';
/**
 * Keys of behaviors that no longer have a switch. Handoff follow-through is
 * always on since ui17 job 17 (clicking Handoff is the consent), so its stored
 * value is deleted rather than left behind to confuse a later reader.
 */
const RETIRED_BEHAVIOR_KEYS = ['watchdog_handoff_automation'] as const;
const ROTATION_THRESHOLD_KEY = 'planner_rotation_threshold';
const ROTATION_THRESHOLD_DEFAULT = 60;

type UsageAlertThresholds = {
  accountWarning: number;
  accountUrgent: number;
  fleetWarning: number;
  fleetUrgent: number;
  fleetSevenDay: number;
};

const USAGE_ALERT_THRESHOLDS_KEY = 'usage_alert_thresholds';
const USAGE_ALERT_THRESHOLDS_DEFAULTS: UsageAlertThresholds = {
  accountWarning: 75,
  accountUrgent: 90,
  fleetWarning: 75,
  fleetUrgent: 90,
  fleetSevenDay: 90,
};

export type ModelRole = 'planner' | 'worker';
export type ModelSelection = { provider: string; model: string; effort: string };

/** Seeds for the Models section: what a new session of each role starts with. */
const MODEL_ROLE_DEFAULTS: Record<ModelRole, ModelSelection> = {
  planner: { provider: 'claude', model: 'claude-fable-5-1', effort: 'medium' },
  worker: { provider: 'claude', model: 'claude-fable-5-1', effort: 'high' },
};
const LEGACY_CLAUDE_MODEL_DEFAULT = 'claude-fable-5';

const modelSettingKey = (role: ModelRole): string => `model_default_${role}`;
const modelDefaultMigrationKey = (role: ModelRole): string => `model_default_fable_5_1_migrated_${role}`;

const PLANNER_MCP_SERVERS = [
  'spoton-core',
  'spoton-sign',
  'playwright',
  'twilio',
  'resend',
  'cloudflare-api',
  'github',
  'railway',
  'forge-propagator',
] as const;
const DEFAULT_PLANNER_MCP_SERVERS = ['spoton-core', 'spoton-sign', 'playwright'] as const;
/** Server ids accepted by Settings routes and the planner runtime allowlist. */
export type PlannerMcpServer = (typeof PLANNER_MCP_SERVERS)[number];

const plannerMcpSettingKey = (projectPath: string): string => `planner_mcp_servers:${projectPath}`;

const settingsLog = (message: string) => {
  console.log(`[Settings] ${message}`);
};

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
  // One key for planner rotation: a legacy value moves to the System-tab key
  // the first time the service loads, then the legacy row is gone for good.
  const legacyRotation = dependencies.appConfig.get(LEGACY_ROTATION_KEY);
  if (legacyRotation !== null) {
    if (dependencies.appConfig.get(watchdogSettingKey('plannerRotation')) === null) {
      dependencies.appConfig.set(watchdogSettingKey('plannerRotation'), legacyRotation === '0' ? '0' : '1');
    }
    dependencies.appConfig.remove(LEGACY_ROTATION_KEY);
  }

  for (const retiredKey of RETIRED_BEHAVIOR_KEYS) {
    if (dependencies.appConfig.get(retiredKey) !== null) {
      dependencies.appConfig.remove(retiredKey);
    }
  }

  const readModelDefault = (role: ModelRole): ModelSelection => {
    const stored = dependencies.appConfig.get(modelSettingKey(role));
    if (stored === null) {
      return MODEL_ROLE_DEFAULTS[role];
    }
    const selection = JSON.parse(stored) as ModelSelection;
    if (
      selection.provider === 'claude'
      && selection.model === LEGACY_CLAUDE_MODEL_DEFAULT
      && dependencies.appConfig.get(modelDefaultMigrationKey(role)) === null
    ) {
      const migrated = { ...selection, model: MODEL_ROLE_DEFAULTS[role].model };
      dependencies.appConfig.set(modelSettingKey(role), JSON.stringify(migrated));
      dependencies.appConfig.set(modelDefaultMigrationKey(role), '1');
      return migrated;
    }
    return selection;
  };

  const readPlannerMcpServers = (projectPath: string): PlannerMcpServer[] => {
    const stored = dependencies.appConfig.get(plannerMcpSettingKey(projectPath));
    if (stored === null) {
      return [...DEFAULT_PLANNER_MCP_SERVERS];
    }
    try {
      const parsed = JSON.parse(stored) as unknown;
      return Array.isArray(parsed)
        ? PLANNER_MCP_SERVERS.filter((server) => parsed.includes(server))
        : [...DEFAULT_PLANNER_MCP_SERVERS];
    } catch {
      return [...DEFAULT_PLANNER_MCP_SERVERS];
    }
  };

  const readUsageAlertThresholds = (): UsageAlertThresholds => {
    const stored = dependencies.appConfig.get(USAGE_ALERT_THRESHOLDS_KEY);
    if (stored === null) {
      return { ...USAGE_ALERT_THRESHOLDS_DEFAULTS };
    }
    try {
      const parsed = JSON.parse(stored) as Partial<UsageAlertThresholds>;
      return Object.fromEntries(
        (Object.keys(USAGE_ALERT_THRESHOLDS_DEFAULTS) as Array<keyof UsageAlertThresholds>).map((key) => [
          key,
          typeof parsed[key] === 'number' && Number.isFinite(parsed[key])
            ? Math.round(parsed[key])
            : USAGE_ALERT_THRESHOLDS_DEFAULTS[key],
        ]),
      ) as UsageAlertThresholds;
    } catch {
      return { ...USAGE_ALERT_THRESHOLDS_DEFAULTS };
    }
  };

  return {
    /** Watchdog module reads the stored automation policy before acting. */
    isWatchdogBehaviorEnabled(behavior: WatchdogBehavior): boolean {
      const stored = dependencies.appConfig.get(watchdogSettingKey(behavior));
      return stored === null ? WATCHDOG_DEFAULTS[behavior] : stored === '1';
    },
    /** Context-usage percentage at which the rotation sweep runs a handoff. */
    plannerRotationThreshold(): number {
      return Number(dependencies.appConfig.get(ROTATION_THRESHOLD_KEY) ?? ROTATION_THRESHOLD_DEFAULT);
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
        plannerRotationThreshold: this.plannerRotationThreshold(),
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
        dependencies.appConfig.set(ROTATION_THRESHOLD_KEY, String(plannerRotationThreshold));
      }
      return this.getWatchdogSettings();
    },
    /** Accounts monitor and System tab share these persisted usage-alert crossings. */
    getUsageAlertSettings() {
      return {
        thresholds: readUsageAlertThresholds(),
        defaults: USAGE_ALERT_THRESHOLDS_DEFAULTS,
      };
    },
    /** System tab persists a validated partial threshold edit. */
    updateUsageAlertSettings(thresholds: Partial<UsageAlertThresholds>) {
      const next = { ...readUsageAlertThresholds(), ...thresholds };
      dependencies.appConfig.set(USAGE_ALERT_THRESHOLDS_KEY, JSON.stringify(next));
      return this.getUsageAlertSettings();
    },
    /** Models section: the model and effort a new session of each role starts with. */
    getModelDefaults() {
      return {
        roles: {
          planner: readModelDefault('planner'),
          worker: readModelDefault('worker'),
        },
        defaults: MODEL_ROLE_DEFAULTS,
      };
    },
    updateModelDefaults(roles: Partial<Record<ModelRole, ModelSelection>>) {
      for (const [role, selection] of Object.entries(roles) as [ModelRole, ModelSelection][]) {
        dependencies.appConfig.set(modelSettingKey(role), JSON.stringify(selection));
        // Any Settings save is explicit. The migration must never rewrite a
        // later deliberate Fable 5 choice back to Fable 5.1.
        dependencies.appConfig.set(modelDefaultMigrationKey(role), '1');
      }
      return this.getModelDefaults();
    },
    /** Per-project MCP allowlist applied only to interactive planner turns. */
    getPlannerMcpSettings(projectPath: string) {
      return {
        projectPath,
        enabled: readPlannerMcpServers(projectPath),
        servers: PLANNER_MCP_SERVERS,
        defaults: DEFAULT_PLANNER_MCP_SERVERS,
      };
    },
    updatePlannerMcpSettings(projectPath: string, enabled: PlannerMcpServer[]) {
      const allowed = PLANNER_MCP_SERVERS.filter((server) => enabled.includes(server));
      dependencies.appConfig.set(plannerMcpSettingKey(projectPath), JSON.stringify(allowed));
      return this.getPlannerMcpSettings(projectPath);
    },
    /**
     * What a spawned planner or direct worker session runs with: the newest
     * previous row of the same role in the project carries its provider,
     * model and effort forward; the Models default covers a project with no
     * such row (or a row that never recorded one of the two). A session that
     * already exists passes its provider, and only a previous row on that
     * provider carries; the watchdog's planner spawns pass null and take the
     * previous row's provider (else the Models default's).
     */
    resolveSpawnSelection(
      role: ModelRole,
      requestedProvider: string | null,
      projectPath: string,
      excludeSessionId: string | null,
    ): { provider: string; model: string; effort: string; source: string } {
      const fallback = readModelDefault(role);
      const previous = dependencies.sessions.latestByOrigin(
        projectPath,
        role === 'planner' ? 'planner' : 'direct',
        excludeSessionId,
      );
      const provider = requestedProvider ?? previous?.provider ?? fallback.provider;
      const carried = previous && previous.provider === provider ? previous : null;
      const model = carried?.model ?? (fallback.provider === provider ? fallback.model : '');
      // 'default' is the composer's untouched placeholder (recorded on every
      // send), not a pick: the Models default effort applies instead.
      const effort = carried?.effort && carried.effort !== 'default' ? carried.effort : fallback.effort;
      const source = carried
        ? `previous ${role} row ${carried.session_id}`
        : `Models default (no previous ${role} row on ${provider})`;
      settingsLog(`${role} spawn selection: provider=${provider} model=${model || '(runtime default)'} effort=${effort} from ${source}`);
      return { provider, model, effort, source };
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

      if (!dependencies.pushSubscriptions.has(userId, endpoint)) {
        throw new AppError('The push subscription was not stored', {
          code: 'PUSH_SUBSCRIPTION_NOT_STORED',
          statusCode: 500,
        });
      }

      const currentPreferences = dependencies.notifications.getPreferences(userId);
      let storedPreferences = currentPreferences;
      if (!currentPreferences?.channels?.webPush) {
        storedPreferences = dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences?.channels, webPush: true },
        }) as NotificationPreferences;
      }
      const event = dependencies.notifications.createEnabledEvent();
      void dependencies.notifications.notifyUser(userId, event);
      return { success: true, subscribed: true, preferences: storedPreferences };
    },
    getPushSubscriptionStatus(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      return { subscribed: dependencies.pushSubscriptions.has(userId, endpoint) };
    },
    unsubscribeFromPush(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      dependencies.pushSubscriptions.remove(endpoint);
      const currentPreferences = dependencies.notifications.getPreferences(userId);
      let storedPreferences = currentPreferences;
      if (currentPreferences?.channels?.webPush) {
        storedPreferences = dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences.channels, webPush: false },
        }) as NotificationPreferences;
      }
      return { success: true, subscribed: false, preferences: storedPreferences };
    },
  };
}
