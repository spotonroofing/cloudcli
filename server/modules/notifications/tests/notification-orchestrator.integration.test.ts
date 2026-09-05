import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import webPush from 'web-push';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import {
  buildNotificationPayload,
  sendFleetNotification,
} from '../services/notification-orchestrator.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('notification payload uses the app session id for a provider session id', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

    const payload = buildNotificationPayload({
      provider: 'claude',
      sessionId: 'claude-native-1',
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason: 'completed' },
    });

    assert.equal(payload.data.sessionId, 'app-session-1');
    assert.equal(payload.data.origin, null);
    assert.equal(payload.data.chainSlug, null);
    assert.match(payload.data.tag, /app-session-1/);
  });
});

test('fleet notices honor per-kind and channel policy before Web Push delivery', async () => {
  await withIsolatedDatabase(async () => {
    const user = userDb.createUser('notification-policy', 'test-hash');
    const userId = Number(user.id);
    pushSubscriptionsDb.saveSubscription(userId, 'https://push.example.test/device-a', 'p256dh', 'auth');
    const originalSendNotification = webPush.sendNotification;
    const payloads: string[] = [];
    const frames: string[] = [];
    const client = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => frames.push(message),
    } as unknown as RealtimeClientConnection;
    connectedClients.add(client);
    webPush.sendNotification = async (_subscription, payload) => {
      payloads.push(payload ?? '');
      return {};
    };

    try {
      notificationPreferencesDb.updatePreferences(userId, {
        channels: { inApp: false, webPush: true, desktop: false, sound: false },
        events: { actionRequired: false, stop: true, error: false },
      });
      await sendFleetNotification({
        kind: 'decision-needed',
        title: 'Blocked chain',
        body: 'A decision is required.',
      });
      assert.equal(payloads.length, 0, 'disabled action-required notices do not bypass policy');
      assert.equal(frames.length, 0, 'disabled kinds do not reach foreground clients');

      await sendFleetNotification({
        kind: 'verified-done',
        title: 'Clean chain',
        body: 'The chain completed cleanly.',
        data: { sessionId: 'worker-session', chainSlug: 'policy-stub', origin: 'dispatch' },
      });
      assert.equal(payloads.length, 1);
      const delivered = JSON.parse(payloads[0]) as { data?: Record<string, unknown> };
      assert.equal(delivered.data?.sessionId, 'worker-session');
      assert.equal(delivered.data?.chainSlug, 'policy-stub');
      assert.equal(frames.length, 0, 'disabled in-app and sound channels are honored');

      notificationPreferencesDb.updatePreferences(userId, {
        channels: { inApp: true, webPush: false, desktop: false, sound: false },
        events: { actionRequired: true, stop: true, error: true },
      });
      await sendFleetNotification({
        kind: 'recovery',
        title: 'Recovering chain',
        body: 'No action is needed.',
      });
      assert.equal(payloads.length, 1, 'disabled Web Push channel is honored');
      assert.equal(frames.length, 1, 'enabled in-app delivery uses the same event policy');
    } finally {
      connectedClients.delete(client);
      webPush.sendNotification = originalSendNotification;
    }
  });
});
