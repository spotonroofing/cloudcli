import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function storedConfig(entries: [string, string][] = []): Dependencies['appConfig'] & { map: Map<string, string> } {
  const map = new Map<string, string>(entries);
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    appConfig: storedConfig(),
    sessions: { latestByOrigin: () => null },
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
  const appConfig = storedConfig([
    ['watchdog_liveness_sweep', '0'],
    ['watchdog_planner_rotation', '1'],
  ]);
  const service = createSettingsService(dependencies({ appConfig }));

  const initial = service.getWatchdogSettings();
  assert.deepEqual(initial.defaults, {
    plannerRotation: false,
    terminalWakes: true,
    livenessSweep: true,
    dispatchRunLiveness: true,
    resourceAlerts: true,
    weeklySelfTest: true,
    weeklyMaintenance: true,
    handoffAutomation: false,
    punchlistWatching: true,
    recoveryNotices: true,
  });
  assert.equal(initial.settings.plannerRotation, true);
  assert.equal(initial.settings.handoffAutomation, false);
  assert.equal(initial.settings.livenessSweep, false);
  assert.equal(initial.settings.terminalWakes, true);
  assert.equal(initial.settings.weeklyMaintenance, true);
  assert.equal(initial.plannerRotationThreshold, 60);

  const updated = service.updateWatchdogSettings({ resourceAlerts: false }, 70);
  assert.equal(updated.settings.resourceAlerts, false);
  assert.equal(updated.plannerRotationThreshold, 70);
  assert.equal(service.plannerRotationThreshold(), 70);
  assert.equal(appConfig.map.get('watchdog_resource_alerts'), '0');
});

test('legacy planner_rotation_enabled folds into watchdog_planner_rotation once', () => {
  const appConfig = storedConfig([['planner_rotation_enabled', '0']]);
  const service = createSettingsService(dependencies({ appConfig }));
  assert.equal(service.isWatchdogBehaviorEnabled('plannerRotation'), false);
  assert.equal(appConfig.map.get('watchdog_planner_rotation'), '0');
  assert.equal(appConfig.map.has('planner_rotation_enabled'), false);

  // A legacy "on" (absent meant on) becomes an explicit on, and the System-tab
  // key wins when both exist.
  const both = storedConfig([['planner_rotation_enabled', '1'], ['watchdog_planner_rotation', '0']]);
  createSettingsService(dependencies({ appConfig: both }));
  assert.equal(both.map.get('watchdog_planner_rotation'), '0');
  assert.equal(both.map.has('planner_rotation_enabled'), false);
});

test('usage alert thresholds keep the documented defaults and persist edits', () => {
  const appConfig = storedConfig();
  const service = createSettingsService(dependencies({ appConfig }));

  assert.deepEqual(service.getUsageAlertSettings(), {
    thresholds: {
      accountWarning: 75,
      accountUrgent: 90,
      fleetWarning: 75,
      fleetUrgent: 90,
      fleetSevenDay: 90,
    },
    defaults: {
      accountWarning: 75,
      accountUrgent: 90,
      fleetWarning: 75,
      fleetUrgent: 90,
      fleetSevenDay: 90,
    },
  });

  const edited = service.updateUsageAlertSettings({ accountWarning: 72, fleetSevenDay: 88 });
  assert.equal(edited.thresholds.accountWarning, 72);
  assert.equal(edited.thresholds.accountUrgent, 90);
  assert.equal(edited.thresholds.fleetSevenDay, 88);
  assert.equal(appConfig.map.get('usage_alert_thresholds'), JSON.stringify(edited.thresholds));
});

test('model defaults seed per role and round-trip through the store', () => {
  const appConfig = storedConfig();
  const service = createSettingsService(dependencies({ appConfig }));
  const seeded = service.getModelDefaults();
  assert.deepEqual(seeded.roles.planner, { provider: 'claude', model: 'claude-fable-5', effort: 'medium' });
  assert.deepEqual(seeded.roles.worker, { provider: 'claude', model: 'claude-fable-5', effort: 'high' });

  const updated = service.updateModelDefaults({ worker: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' } });
  assert.deepEqual(updated.roles.worker, { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  assert.deepEqual(updated.roles.planner, seeded.roles.planner);
  assert.deepEqual(
    createSettingsService(dependencies({ appConfig })).getModelDefaults().roles.worker,
    { provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  );
});

test('planner MCP settings default to the three core servers and stay project-scoped', () => {
  const appConfig = storedConfig();
  const service = createSettingsService(dependencies({ appConfig }));

  assert.deepEqual(service.getPlannerMcpSettings('/workspace/alpha').enabled, [
    'spoton-core',
    'spoton-sign',
    'playwright',
  ]);

  service.updatePlannerMcpSettings('/workspace/alpha', ['spoton-core', 'github']);
  assert.deepEqual(service.getPlannerMcpSettings('/workspace/alpha').enabled, ['spoton-core', 'github']);
  assert.deepEqual(service.getPlannerMcpSettings('/workspace/beta').enabled, [
    'spoton-core',
    'spoton-sign',
    'playwright',
  ]);
  assert.equal(
    appConfig.map.get('planner_mcp_servers:/workspace/alpha'),
    '["spoton-core","github"]',
  );
});

test('spawn selection carries the previous row of the role, else the Models default', () => {
  const rows: Record<string, { session_id: string; provider: string; model: string | null; effort: string | null }> = {
    planner: { session_id: 'prev-planner', provider: 'claude', model: 'claude-fable-5', effort: 'xhigh' },
    direct: { session_id: 'prev-worker', provider: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  };
  const seen: unknown[] = [];
  const service = createSettingsService(dependencies({
    sessions: {
      latestByOrigin: (projectPath, origin, excludeSessionId) => {
        seen.push([projectPath, origin, excludeSessionId]);
        return projectPath === '/p' ? rows[origin] : null;
      },
    },
  }));

  const planner = service.resolveSpawnSelection('planner', 'claude', '/p', 'new-1');
  assert.equal(planner.model, 'claude-fable-5');
  assert.equal(planner.effort, 'xhigh');
  assert.deepEqual(seen[0], ['/p', 'planner', 'new-1']);

  // No previous planner row in this project: the Models default.
  const fresh = service.resolveSpawnSelection('planner', 'claude', '/empty', null);
  assert.equal(fresh.model, 'claude-fable-5');
  assert.equal(fresh.effort, 'medium');

  // A previous worker row on another provider does not leak its model into
  // a Claude worker; the effort default still applies.
  const worker = service.resolveSpawnSelection('worker', 'claude', '/p', 'new-2');
  assert.equal(worker.model, 'claude-fable-5');
  assert.equal(worker.effort, 'high');
  const codexWorker = service.resolveSpawnSelection('worker', 'codex', '/p', 'new-3');
  assert.equal(codexWorker.model, 'gpt-5.6-sol');
  assert.equal(codexWorker.effort, 'xhigh');

  // No provider requested (the watchdog's planner spawns): the previous row's
  // provider carries with its pair; a project with no row takes the default's.
  const derived = service.resolveSpawnSelection('worker', null, '/p', 'new-5');
  assert.equal(derived.provider, 'codex');
  assert.equal(derived.model, 'gpt-5.6-sol');
  const derivedFresh = service.resolveSpawnSelection('planner', null, '/empty', null);
  assert.equal(derivedFresh.provider, 'claude');
  assert.equal(derivedFresh.model, 'claude-fable-5');

  // The composer records 'default' on every send when nothing was picked;
  // that placeholder is not a pick, so the Models default effort applies.
  rows.planner = { session_id: 'prev-untouched', provider: 'claude', model: 'claude-fable-5', effort: 'default' };
  const untouched = service.resolveSpawnSelection('planner', 'claude', '/p', 'new-4');
  assert.equal(untouched.model, 'claude-fable-5');
  assert.equal(untouched.effort, 'medium');
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
