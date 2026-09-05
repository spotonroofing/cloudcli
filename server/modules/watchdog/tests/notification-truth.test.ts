import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
  watchdogDb,
} from '@/modules/database/index.js';
import { settingsService } from '@/modules/settings/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { WatchdogService, watchdogService } from '../watchdog.service.js';

type FleetFrame = {
  kind?: string;
  notificationKind?: string;
  title?: string;
  body?: string;
  sessionId?: string | null;
  chainSlug?: string | null;
  origin?: string | null;
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-truth-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const user = userDb.createUser(`notification-truth-${Date.now()}`, 'unused');
  notificationPreferencesDb.updatePreferences(Number(user.id), {
    channels: { inApp: true, webPush: false, desktop: false, sound: false },
    events: { actionRequired: true, stop: true, error: true },
  });
  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('clean and unsettled chain endings use truthful kinds and carry the build session', async () => {
  await withIsolatedDatabase(() => {
    settingsService.updateWatchdogSettings({ terminalWakes: false });
    const frames: FleetFrame[] = [];
    const client = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => frames.push(JSON.parse(message) as FleetFrame),
    } as unknown as RealtimeClientConnection;
    connectedClients.add(client);

    try {
      const cleanSlug = `notification-clean-${Date.now()}`;
      const cleanProject = '/workspace/notification-clean';
      watchdogService.registerChain({
        slug: cleanSlug,
        projectPath: cleanProject,
        phases: 1,
        manifest: [{ name: 'Clean', tasks: ['Finish'], kind: 'phase' }],
      });
      sessionsDb.setSessionOrigin(
        'clean-build-session', 'dispatch', null, cleanSlug, null,
        { provider: 'codex', projectPath: cleanProject }, 1, 'Clean',
      );
      watchdogService.chainEvent(cleanSlug, 'phase-start', { phase: 1 });
      watchdogService.chainEvent(cleanSlug, 'phase-end', { phase: 1 });
      watchdogService.chainEvent(cleanSlug, 'verify-start', { phase: 1 });
      watchdogService.chainEvent(cleanSlug, 'verify-end', { phase: 1, verdict: 'PASS' });
      watchdogService.chainEvent(cleanSlug, 'completed', { phase: 1 });

      const clean = frames.find((frame) => frame.title === `Chain ${cleanSlug} completed`);
      assert.equal(clean?.notificationKind, 'verified-done');
      assert.equal(clean?.sessionId, 'clean-build-session');
      assert.equal(clean?.chainSlug, cleanSlug);
      assert.equal(clean?.origin, 'dispatch');
      assert.match(clean?.body ?? '', /completed cleanly/);
      assert.doesNotMatch(clean?.body ?? '', /verify the result|append a fix unit/i);

      const failedSlug = `notification-failed-${Date.now()}`;
      const failedProject = '/workspace/notification-failed';
      watchdogService.registerChain({
        slug: failedSlug,
        projectPath: failedProject,
        phases: 1,
        manifest: [{ name: 'Failed verify', tasks: ['Finish'], kind: 'phase' }],
      });
      sessionsDb.setSessionOrigin(
        'failed-build-session', 'dispatch', null, failedSlug, null,
        { provider: 'claude', projectPath: failedProject }, 1, 'Failed verify',
      );
      watchdogService.chainEvent(failedSlug, 'phase-start', { phase: 1 });
      watchdogService.chainEvent(failedSlug, 'phase-end', { phase: 1 });
      watchdogService.chainEvent(failedSlug, 'verify-start', { phase: 1 });
      watchdogService.chainEvent(failedSlug, 'verify-end', {
        phase: 1,
        verdict: 'INCONCLUSIVE',
        summaryTail: 'the dev endpoint was unavailable',
      });
      watchdogService.chainEvent(failedSlug, 'completed', { phase: 1 });

      const failed = frames.find((frame) => frame.title?.startsWith(`Chain ${failedSlug} completed with`));
      assert.equal(failed?.notificationKind, 'decision-needed');
      assert.equal(failed?.sessionId, 'failed-build-session');
      assert.match(failed?.body ?? '', /inconclusive.*dev endpoint was unavailable/i);
    } finally {
      connectedClients.delete(client);
    }
  });
});

test('two persisted wakes replay once and in order when a watchdog service starts', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/durable-wakes';
    sessionsDb.createAppSession('durable-wake-planner', 'claude', projectPath, 'Planner', 'planner');
    watchdogDb.createWake({
      project_path: projectPath,
      prompt: 'first persisted wake',
      fresh_boot: 0,
      chain_slug: null,
      target_session_id: null,
      failures: 0,
    });
    watchdogDb.createWake({
      project_path: projectPath,
      prompt: 'second persisted wake',
      fresh_boot: 0,
      chain_slug: null,
      target_session_id: null,
      failures: 0,
    });

    const delivered: string[] = [];
    const restarted = new WatchdogService();
    const testService = restarted as unknown as {
      runPlannerTurn: (...args: unknown[]) => Promise<{
        errored: boolean;
        errorMessage: null;
        announcedSessionId: string;
      }>;
      sweeper: ReturnType<typeof setInterval> | null;
      selfTestTimer: ReturnType<typeof setTimeout> | null;
    };
    testService.runPlannerTurn = async (...args: unknown[]) => {
      delivered.push(String(args[5]));
      return { errored: false, errorMessage: null, announcedSessionId: 'durable-wake-planner' };
    };
    restarted.start();

    const deadline = Date.now() + 2_000;
    while (watchdogDb.listWakes(projectPath).some((wake) => wake.state !== 'delivered') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(delivered, ['first persisted wake', 'second persisted wake']);
    assert.deepEqual(watchdogDb.listWakes(projectPath).map((wake) => wake.state), ['delivered', 'delivered']);
    if (testService.sweeper) clearInterval(testService.sweeper);
    if (testService.selfTestTimer) clearTimeout(testService.selfTestTimer);
  });
});
