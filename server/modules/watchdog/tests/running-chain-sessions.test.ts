import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appConfigDb, closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { watchdogService } from '@/modules/watchdog/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'running-chain-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a running chain unit and its verify session feed the running-sessions poll; a finished unit does not', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/beam-project';
    const messages: string[] = [];
    const notificationClient = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => { messages.push(message); },
    } as unknown as RealtimeClientConnection;
    connectedClients.add(notificationClient);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    projectsDb.createProjectPath(projectPath);
    watchdogService.registerChain({
      slug: 'beamstub',
      projectPath,
      phases: 2,
      manifest: [{ name: 'One', tasks: [], kind: 'phase' }, { name: 'Two', tasks: [], kind: 'phase' }],
    });

    // Job 1 runs: the runner announces its build session with the prompt's name header.
    watchdogService.chainEvent('beamstub', 'phase-start', { phase: 1 });
    sessionsDb.setSessionOrigin('build-1', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 1, 'One');
    assert.deepEqual(
      watchdogService.listActiveDispatchRuns().map((run) => run.sessionId),
      ['build-1'],
      'the active build session is live even though no in-server run registered it',
    );
    assert.equal(sessionsDb.getSessionById('build-1')?.custom_name, 'One');

    // Job 1 ends and its verify starts while job 2 builds: both the verify
    // session and the new build are live; the finished build is not.
    watchdogService.chainEvent('beamstub', 'phase-end', { phase: 1 });
    assert.deepEqual(watchdogService.listActiveDispatchRuns(), []);
    watchdogService.chainEvent('beamstub', 'verify-start', { phase: 1 });
    sessionsDb.setSessionOrigin('verify-1', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 1, 'Verify: One');
    watchdogService.setChainVerifySession('beamstub', 1, 'verify-1');
    watchdogService.chainEvent('beamstub', 'phase-start', { phase: 2 });
    sessionsDb.setSessionOrigin('build-2', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 2, 'Two');
    assert.deepEqual(
      watchdogService.listActiveDispatchRuns().map((run) => run.sessionId).sort(),
      ['build-2', 'verify-1'],
    );
    assert.equal(sessionsDb.getSessionById('verify-1')?.custom_name, 'Verify: One');

    // A terminal chain has no live sessions.
    try {
      watchdogService.chainEvent('beamstub', 'stopped', { phase: 2 });
      assert.deepEqual(watchdogService.listActiveDispatchRuns(), []);
      const terminalNotice = messages
        .map((message) => JSON.parse(message) as { kind?: string; notificationKind?: string; title?: string })
        .find((message) => message.kind === 'fleet_notification' && message.title === 'Chain beamstub stopped');
      assert.equal(terminalNotice?.notificationKind, 'decision-needed');
    } finally {
      connectedClients.delete(notificationClient);
    }
  });
});

test('an announced title replaces a prompt-shaped name discovery wrote first', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/title-project';
    projectsDb.createProjectPath(projectPath);
    const id = sessionsDb.createSession('thread-1', 'codex', projectPath, '<!-- name: Two --> Execute Job 2', undefined, undefined, null, null);
    sessionsDb.setSessionOrigin('thread-1', 'dispatch', null, 'demo', null, { provider: 'codex', projectPath }, 2, 'Two');
    assert.equal(sessionsDb.getSessionById(id)?.custom_name, 'Two');
    // No title announced: the existing name is left alone.
    sessionsDb.setSessionOrigin('thread-1', 'dispatch', null, 'demo', null, { provider: 'codex', projectPath }, 2);
    assert.equal(sessionsDb.getSessionById(id)?.custom_name, 'Two');
  });
});
