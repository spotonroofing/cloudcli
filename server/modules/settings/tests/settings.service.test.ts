import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    appConfig: { get: () => null, set: () => undefined },
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    pushSubscriptions: { save: () => undefined, remove: () => undefined, has: () => false },
    getVapidPublicKey: () => null,
    ...overrides,
  };
}

test('watchdog automation defaults protect Willem sessions and stored values win', () => {
  const stored = new Map<string, string>([
    ['watchdog_liveness_sweep', '0'],
    ['watchdog_terminal_wakes', '1'],
  ]);
  const service = createSettingsService(dependencies({
    appConfig: {
      get: (key) => stored.get(key) ?? null,
      set: (key, value) => { stored.set(key, value); },
    },
  }));

  const initial = service.getWatchdogSettings();
  assert.equal(initial.settings.plannerRotation, false);
  assert.equal(initial.settings.weeklyMaintenance, false);
  assert.equal(initial.settings.handoffAutomation, false);
  assert.equal(initial.settings.livenessSweep, false);
  assert.equal(initial.settings.terminalWakes, true);

  const updated = service.updateWatchdogSettings({ resourceAlerts: false }, 70);
  assert.equal(updated.settings.resourceAlerts, false);
  assert.equal(updated.plannerRotationThreshold, 70);
  assert.equal(stored.get('watchdog_resource_alerts'), '0');
});

test('subscribeToPush persists the subscription and enables Web Push', () => {
  const operations: string[] = [];
  const service = createSettingsService(dependencies({
    pushSubscriptions: {
      save: (_id, endpoint) => operations.push(`save:${endpoint}`),
      remove: () => undefined,
      has: () => false,
    },
    notifications: {
      getPreferences: () => ({ channels: { webPush: false } }),
      updatePreferences: () => { operations.push('preferences'); return {}; },
      createEnabledEvent: () => ({ code: 'push.enabled' }),
      notifyUser: () => { operations.push('notify'); },
    },
  }));

  service.subscribeToPush(1, {
    endpoint: 'https://push.example.test',
    keys: { p256dh: 'key', auth: 'auth' },
  });
  assert.deepEqual(operations, ['save:https://push.example.test', 'preferences', 'notify']);
});
