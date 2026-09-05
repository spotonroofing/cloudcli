import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';

import { sendDesktopNotification as sendDesktopNotificationToClients } from './desktop-notification-clients.service.js';

type NotificationEventKind = 'action_required' | 'stop' | 'error' | 'info';
type FleetNotificationKind = 'decision-needed' | 'verified-done' | 'recovery' | 'usage-alert';

type NotificationEvent = {
  provider: string;
  sessionId: string | null;
  kind: NotificationEventKind;
  code: string;
  meta: Record<string, unknown>;
  severity: string;
  requiresUserAction: boolean;
  dedupeKey: string | null;
  createdAt: string;
};

function normalizeEventInput(input: unknown): NotificationEvent {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const meta = source.meta && typeof source.meta === 'object'
    ? source.meta as Record<string, unknown>
    : {};
  const kind = source.kind === 'action_required' || source.kind === 'stop'
    || source.kind === 'error' || source.kind === 'info'
    ? source.kind
    : 'info';
  return {
    provider: typeof source.provider === 'string' ? source.provider : 'system',
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
    kind,
    code: typeof source.code === 'string' ? source.code : 'generic.info',
    meta,
    severity: typeof source.severity === 'string' ? source.severity : 'info',
    requiresUserAction: source.requiresUserAction === true,
    dedupeKey: typeof source.dedupeKey === 'string' ? source.dedupeKey : null,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
  };
}

type NotificationPayload = {
  title: string;
  body: string;
  data: Record<string, unknown> & {
    sessionId: string | null;
    provider: string | null;
    tag: string;
  };
};

type NotificationPreferences = ReturnType<typeof notificationPreferencesDb.getPreferences>;

const KIND_TO_PREF_KEY: Partial<Record<NotificationEventKind, keyof NotificationPreferences['events']>> = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error',
};

const FLEET_KIND_TO_EVENT_KIND: Record<FleetNotificationKind, NotificationEventKind> = {
  'decision-needed': 'action_required',
  'verified-done': 'stop',
  recovery: 'stop',
  'usage-alert': 'error',
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  system: 'System',
};

const recentEventKeys = new Map<string, number>();
const DEDUPE_WINDOW_MS = 20_000;

const cleanupOldEventKeys = (): void => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function isNotificationEventEnabled(preferences: NotificationPreferences, event: NotificationEvent): boolean {
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  return prefEventKey ? Boolean(preferences.events[prefEventKey]) : true;
}

function isDuplicate(event: NotificationEvent): boolean {
  cleanupOldEventKeys();
  const key = event.dedupeKey
    || `${event.provider}:${event.kind}:${event.code}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

/**
 * Used by provider runtimes and Settings to create the normalized event shape
 * consumed by the notification delivery policy.
 */
export function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false,
}: {
  provider: string;
  sessionId?: string | null;
  kind?: NotificationEventKind;
  code?: string;
  meta?: Record<string, unknown>;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
}): NotificationEvent {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString(),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error == null) return 'Unknown error';
  return String(error);
}

function normalizeSessionName(sessionName: unknown): string | null {
  if (typeof sessionName !== 'string') return null;
  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function resolveSessionRow(sessionId: string | null, provider: string) {
  if (!sessionId) return null;

  const appSessionRow = sessionsDb.getSessionById(sessionId);
  if (appSessionRow && (!provider || appSessionRow.provider === provider)) {
    return appSessionRow;
  }

  const providerSessionRow = sessionsDb.getSessionByProviderSessionId(sessionId);
  if (providerSessionRow && (!provider || providerSessionRow.provider === provider)) {
    return providerSessionRow;
  }
  return null;
}

function normalizeNotificationSession(event: NotificationEvent): NotificationEvent {
  if (!event.sessionId || !event.provider || event.provider === 'system') return event;
  const row = resolveSessionRow(event.sessionId, event.provider);
  return row && row.session_id !== event.sessionId ? { ...event, sessionId: row.session_id } : event;
}

function resolveSessionName(event: NotificationEvent): string | null {
  const explicitSessionName = normalizeSessionName(event.meta.sessionName);
  if (explicitSessionName) return explicitSessionName;
  if (!event.sessionId || !event.provider) return null;
  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

/** Used by notification tests and delivery workflows to build channel payloads. */
export function buildNotificationPayload(event: unknown): NotificationPayload {
  const normalizedEvent = normalizeNotificationSession(normalizeEventInput(event));
  const codeMap: Record<string, string> = {
    'permission.required': normalizedEvent.meta.toolName
      ? `Action Required: Tool "${String(normalizedEvent.meta.toolName)}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped': typeof normalizedEvent.meta.stopReason === 'string'
      ? normalizedEvent.meta.stopReason
      : 'Run Stopped: The run has stopped',
    'run.background_completed': 'Background work finished',
    'run.failed': normalizedEvent.meta.error
      ? `Run Failed: ${String(normalizedEvent.meta.error)}`
      : 'Run Failed: The run encountered an error',
    'agent.notification': normalizedEvent.meta.message
      ? String(normalizedEvent.meta.message)
      : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!',
  };
  const providerLabel = PROVIDER_LABELS[normalizedEvent.provider] || 'Assistant';
  const sessionName = resolveSessionName(normalizedEvent);
  const message = codeMap[normalizedEvent.code] || 'You have a new notification';
  const row = resolveSessionRow(normalizedEvent.sessionId, normalizedEvent.provider);

  return {
    title: sessionName || 'Command Center',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: normalizedEvent.sessionId,
      code: normalizedEvent.code,
      provider: normalizedEvent.provider || null,
      origin: row?.origin ?? null,
      chainSlug: row?.chain_slug ?? null,
      projectPath: row?.project_path ?? null,
      sessionName,
      tag: `${normalizedEvent.provider || 'assistant'}:${normalizedEvent.sessionId || 'none'}:${normalizedEvent.code}`,
    },
  };
}

async function sendWebPushPayload(userId: number, payload: NotificationPayload): Promise<void> {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return;

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys_p256dh, auth: subscription.keys_auth },
      },
      JSON.stringify(payload),
    )),
  );
  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const statusCode = (result.reason as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
    }
  });
}

const notificationChannels = [
  {
    id: 'webPush',
    isEnabled: (preferences: NotificationPreferences) => preferences.channels.webPush,
    send: (userId: number, payload: NotificationPayload) => sendWebPushPayload(userId, payload),
  },
  {
    id: 'desktop',
    isEnabled: (preferences: NotificationPreferences) => preferences.channels.desktop,
    send: async (userId: number, payload: NotificationPayload) => {
      sendDesktopNotificationToClients(userId, payload);
    },
  },
] as const;

async function deliverThroughEnabledChannels(
  userId: number,
  preferences: NotificationPreferences,
  payload: NotificationPayload,
): Promise<void> {
  await Promise.all(notificationChannels.map(async (channel) => {
    if (!channel.isEnabled(preferences)) return;
    try {
      await channel.send(userId, payload);
    } catch (error) {
      console.error(`Notification channel "${channel.id}" send error:`, error);
    }
  }));
}

function broadcastFleetToEnabledClients(
  kind: FleetNotificationKind,
  payload: NotificationPayload,
  preferences: NotificationPreferences,
): void {
  if (!preferences.channels.inApp && !preferences.channels.sound) return;
  const frame = JSON.stringify({
    ...payload.data,
    kind: 'fleet_notification',
    notificationKind: kind,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    timestamp: new Date().toISOString(),
  });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) client.send(frame);
  });
}

/** Used by provider runtimes and Settings to deliver events through policy-enabled channels. */
export async function notifyUserIfEnabled({
  userId,
  event,
}: {
  userId: number;
  event: unknown;
}): Promise<void> {
  if (!userId || !event) return;
  const normalizedEvent = normalizeNotificationSession(normalizeEventInput(event));
  const preferences = notificationPreferencesDb.getPreferences(userId);
  if (!isNotificationEventEnabled(preferences, normalizedEvent) || isDuplicate(normalizedEvent)) return;
  await deliverThroughEnabledChannels(userId, preferences, buildNotificationPayload(normalizedEvent));
}

/** Used by provider runtimes to report stopped or completed agent runs. */
export function notifyRunStopped({
  userId,
  provider,
  sessionId = null,
  stopReason = 'completed',
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  stopReason?: string;
  sessionName?: string | null;
}): void {
  void notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`,
    }),
  });
}

/** Used by provider runtimes to report background work completed after a turn. */
export function notifyBackgroundWorkCompleted({
  userId,
  provider,
  sessionId = null,
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  sessionName?: string | null;
}): void {
  void notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.background_completed',
      meta: { sessionName },
    }),
  });
}

/** Used by provider runtimes to report failed agent runs. */
export function notifyRunFailed({
  userId,
  provider,
  sessionId = null,
  error,
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  error: unknown;
  sessionName?: string | null;
}): void {
  const errorMessage = normalizeErrorMessage(error);
  void notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`,
    }),
  });
}

/**
 * Used by Accounts and Watchdog to deliver fleet notices through the same
 * per-kind and per-channel policy as provider-run notifications.
 */
export function sendFleetNotification({
  kind,
  title,
  body,
  data = {},
}: {
  kind: FleetNotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const user = userDb.getFirstUser();
  if (!user) return Promise.resolve();

  const event = createNotificationEvent({
    provider: typeof data.provider === 'string' ? data.provider : 'system',
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
    kind: FLEET_KIND_TO_EVENT_KIND[kind],
    code: `fleet.${kind}`,
    meta: data,
    severity: kind === 'decision-needed' || kind === 'usage-alert' ? 'error' : 'info',
    requiresUserAction: kind === 'decision-needed',
    dedupeKey: `fleet:${kind}:${title}:${String(data.sessionId ?? 'none')}`,
  });
  const preferences = notificationPreferencesDb.getPreferences(user.id);
  if (!isNotificationEventEnabled(preferences, event) || isDuplicate(event)) return Promise.resolve();

  const payload: NotificationPayload = {
    title,
    body,
    data: {
      ...data,
      sessionId: event.sessionId,
      provider: event.provider,
      kind,
      tag: `fleet:${kind}:${title}:${String(event.sessionId ?? 'none')}`,
    },
  };
  broadcastFleetToEnabledClients(kind, payload, preferences);
  return deliverThroughEnabledChannels(user.id, preferences, payload);
}
