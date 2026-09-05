import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  apiKeysDb,
  closeConnection,
  initializeDatabase,
  userDb,
  watchdogDb,
} from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

test('the notify path persists one promote attempt from start through failure', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'watchdog-promotes-'));
  const database = path.join(directory, 'auth.db');
  let server: ReturnType<express.Application['listen']> | null = null;
  closeConnection();
  process.env.DATABASE_PATH = database;
  try {
    await initializeDatabase();
    const user = userDb.createUser('promote-record-test', 'unused');
    const apiKey = apiKeysDb.createApiKey(Number(user.id), 'promote-record-test').apiKey;
    const app = express();
    app.use(express.json());
    app.use('/api/watchdog', createWatchdogRouter());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectPath = '/workspace/promoted-project';

    const recorded = await fetch(`${baseUrl}/api/watchdog/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        kind: 'promote-attempt',
        projectPath,
        promotedCommit: 'abc1234567890',
        previousLiveCommit: 'def9876543210',
        dryRun: true,
        stage: 'started',
        status: 'running',
        logPath: '/home/test/forge-logs/promote/20260905-1200/attempt-1',
      }),
    });
    assert.equal(recorded.status, 201);
    const recordedPayload = await recorded.json() as { data: { id: number } };
    assert.equal(watchdogDb.listPromotes(projectPath).length, 1);

    const failed = await fetch(`${baseUrl}/api/watchdog/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        kind: 'promote-attempt',
        attemptId: recordedPayload.data.id,
        projectPath,
        promotedCommit: 'abc1234567890',
        previousLiveCommit: 'def9876543210',
        dryRun: true,
        stage: 'client-test',
        status: 'failed',
        logPath: '/home/test/forge-logs/promote/20260905-1200/attempt-1',
        failureDetail: 'client gate failed',
      }),
    });
    assert.equal(failed.status, 200);
    assert.equal(watchdogDb.listPromotes(projectPath).length, 1);

    const listed = await fetch(`${baseUrl}/api/watchdog/promotes?projectPath=${encodeURIComponent(projectPath)}`, {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(listed.status, 200);
    const payload = await listed.json() as {
      data: { promotes: Array<Record<string, unknown>> };
    };
    assert.deepEqual(payload.data.promotes, [{
      id: 1,
      projectPath,
      promotedAt: payload.data.promotes[0]?.promotedAt,
      startedAt: payload.data.promotes[0]?.startedAt,
      endedAt: payload.data.promotes[0]?.endedAt,
      promotedCommit: 'abc1234567890',
      previousLiveCommit: 'def9876543210',
      dryRun: true,
      stage: 'client-test',
      status: 'failed',
      logPath: '/home/test/forge-logs/promote/20260905-1200/attempt-1',
      failureDetail: 'client gate failed',
    }]);
    assert.equal(typeof payload.data.promotes[0]?.promotedAt, 'number');
    assert.equal(typeof payload.data.promotes[0]?.startedAt, 'number');
    assert.equal(typeof payload.data.promotes[0]?.endedAt, 'number');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('a recorded promote reaches open clients so the jobs column can insert its row live', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'watchdog-promote-feed-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  const messages: string[] = [];
  const client = {
    readyState: WS_OPEN_STATE,
    send: (message: string) => { messages.push(message); },
  } as unknown as RealtimeClientConnection;
  connectedClients.add(client);
  try {
    await initializeDatabase();
    const projectPath = '/workspace/promote-feed-project';
    watchdogService.recordPromoteAttempt({
      projectPath,
      promotedCommit: 'feed1234567',
      previousLiveCommit: 'prev7654321',
      dryRun: false,
      stage: 'complete',
      status: 'passed',
      logPath: '/home/test/forge-logs/promote/20260905-1201/attempt-2',
    });

    const frames = messages
      .map((message) => JSON.parse(message) as { kind?: string; promote?: Record<string, unknown> })
      .filter((frame) => frame.kind === 'promote_recorded');
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.promote?.projectPath, projectPath);
    assert.equal(frames[0]?.promote?.promotedCommit, 'feed1234567');
    assert.equal(typeof frames[0]?.promote?.promotedAt, 'number');
  } finally {
    connectedClients.delete(client);
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
