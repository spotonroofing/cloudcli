import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { watchdogService } from '../index.js';

type Frame = Record<string, unknown>;

async function withIsolatedDatabase(
  runTest: (frames: Frame[]) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'handoff-successor-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const frames: Frame[] = [];
  const client = {
    readyState: WS_OPEN_STATE,
    send: (message: string) => { frames.push(JSON.parse(message) as Frame); },
  } as unknown as RealtimeClientConnection;
  connectedClients.add(client);
  try {
    await runTest(frames);
  } finally {
    connectedClients.delete(client);
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a Handoff click reserves the successor row and announces it before anything boots', async () => {
  await withIsolatedDatabase(async (frames) => {
    const projectPath = '/workspace/handoff-successor-project';
    sessionsDb.createAppSession('outgoing-planner', 'claude', projectPath, 'Planner', 'planner');

    const successorId = watchdogService.plannerHandoffBegin(projectPath, 'outgoing-planner');
    assert.ok(successorId, 'the reservation returns the successor session id');

    const successor = sessionsDb.getSessionById(successorId);
    assert.ok(successor);
    assert.equal(successor.origin, 'planner');
    assert.equal(successor.predecessor_session_id, 'outgoing-planner');
    assert.equal(successor.booted, 1);
    // Reserved, not started: the row reads as loading until the boot runs.
    assert.equal(successor.boot_state, 'pending');
    assert.equal(successor.boot_error, null);

    const announcement = frames.find((frame) => frame.kind === 'planner_handoff');
    assert.ok(announcement, 'clients hear about the successor at once');
    assert.equal(announcement.fromSessionId, 'outgoing-planner');
    assert.equal(announcement.toSessionId, successorId);
  });
});

test('a handoff that fails leaves the successor row in place carrying one plain line', async () => {
  await withIsolatedDatabase(async (frames) => {
    const projectPath = '/workspace/handoff-successor-project';
    sessionsDb.createAppSession('outgoing-planner', 'claude', projectPath, 'Planner', 'planner');
    const successorId = watchdogService.plannerHandoffBegin(projectPath, 'outgoing-planner');
    assert.ok(successorId);

    watchdogService.plannerHandoffFailed(successorId, 'The handoff turn was stopped before it finished.');

    const successor = sessionsDb.getSessionById(successorId);
    assert.ok(successor, 'the placeholder row is never rolled back');
    assert.equal(successor.boot_state, 'failed');
    assert.equal(successor.boot_error, 'The handoff turn was stopped before it finished.');
    // The outgoing planner stays exactly where it was.
    assert.equal(sessionsDb.getSessionById('outgoing-planner')?.boot_state ?? null, null);

    const failure = frames.find((frame) => frame.kind === 'planner_handoff_failed');
    assert.ok(failure);
    assert.equal(failure.toSessionId, successorId);
    assert.equal(failure.reason, 'The handoff turn was stopped before it finished.');
  });
});

test('a failed successor never takes a watchdog wake, and a reserved one is held, not woken', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/handoff-successor-project';
    sessionsDb.createAppSession('outgoing-planner', 'claude', projectPath, 'Planner', 'planner');
    const successorId = watchdogService.plannerHandoffBegin(projectPath, 'outgoing-planner');
    assert.ok(successorId);

    // The reserved row is the lineage successor, so a chain wake resolves to
    // it; the drain holds such a row instead of running a turn in an empty
    // chat, which is what boot_state 'pending' means here.
    const reserved = sessionsDb.resolveWatchdogWakeSession(projectPath, 'outgoing-planner');
    assert.equal(reserved?.session_id, successorId);
    assert.equal(reserved?.boot_state, 'pending');

    watchdogService.plannerHandoffFailed(successorId, 'The handoff turn ended with an error.');
    const afterFailure = sessionsDb.resolveWatchdogWakeSession(projectPath, 'outgoing-planner');
    assert.equal(afterFailure?.session_id, 'outgoing-planner');
  });
});
