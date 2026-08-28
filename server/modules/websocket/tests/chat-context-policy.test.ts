import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, queuedMessagesDb, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, ProviderRuntimeWriter } from '@/shared/types.js';

type MessageHandler = (message: Buffer) => Promise<void>;

class TestSocket extends EventEmitter {
  readyState = WS_OPEN_STATE;
  sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  async receive(payload: unknown): Promise<void> {
    const handler = this.listeners('message')[0] as MessageHandler | undefined;
    assert.ok(handler, 'chat connection registered a message handler');
    await handler(Buffer.from(JSON.stringify(payload)));
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-context-policy-'));
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

const request = { user: { id: 1 } } as AuthenticatedWebSocketRequest;

test('planner turns receive the project allowlist and dispatch turns disable MCP and Codex fast mode', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/context-project';
    sessionsDb.createAppSession('planner-session', 'claude', projectPath, 'Planner', 'planner');
    sessionsDb.createAppSession('dispatch-session', 'codex', projectPath, 'Dispatch', 'dispatch');

    const calls: Array<{ command: string; options: AnyRecord }> = [];
    const socket = new TestSocket();
    handleChatConnection(socket as unknown as WebSocket, request, {
      runtime: {
        hasRuntime: () => true,
        async run(_provider, command, options, _writer: ProviderRuntimeWriter) {
          calls.push({ command, options });
        },
        async abort() { return true; },
        resolveToolApproval() {},
        getPendingApprovalsForSession: () => [],
      },
      resolvePlannerMcpServers: () => ['spoton-core', 'playwright'],
    });

    try {
      await socket.receive({ type: 'chat.send', sessionId: 'planner-session', content: 'planner turn' });
      await socket.receive({
        type: 'chat.send',
        sessionId: 'dispatch-session',
        content: 'dispatch turn',
        options: { fastMode: true },
      });

      assert.equal(calls[0]?.command, 'planner turn');
      assert.equal(calls[0]?.options.mcpPolicy, 'planner');
      assert.deepEqual(calls[0]?.options.allowedMcpServers, ['spoton-core', 'playwright']);
      assert.equal(calls[1]?.command, 'dispatch turn');
      assert.equal(calls[1]?.options.mcpPolicy, 'none');
      assert.equal(calls[1]?.options.fastMode, false);
      assert.equal(sessionsDb.getSessionById('dispatch-session')?.fast_mode, 0);
    } finally {
      connectedClients.delete(socket as unknown as WebSocket);
    }
  });
});

test('stopping an out-of-process dispatch session delegates to chain pause', async () => {
  await withIsolatedDatabase(async () => {
    const paused: string[] = [];
    const socket = new TestSocket();
    handleChatConnection(socket as unknown as WebSocket, request, {
      runtime: {
        hasRuntime: () => true,
        async run() {},
        async abort() { return false; },
        resolveToolApproval() {},
        getPendingApprovalsForSession: () => [],
      },
      async pauseDispatchSession(sessionId) {
        paused.push(sessionId);
        return true;
      },
    });

    try {
      await socket.receive({ type: 'chat.abort', sessionId: 'dispatch-session' });
      assert.deepEqual(paused, ['dispatch-session']);
      assert.equal(
        socket.sent.some((message) => JSON.parse(message).kind === 'protocol_error'),
        false,
      );
    } finally {
      connectedClients.delete(socket as unknown as WebSocket);
    }
  });
});

test('an all-dry interactive Claude limit waits, keeps the queue, and retries when headroom returns', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('interactive-limit', 'claude', '/workspace/limits', 'Worker', 'direct');
    queuedMessagesDb.upsert(
      'interactive-limit',
      'queued-after-limit',
      'keep this queued',
      null,
      null,
      '2026-08-27T12:00:00.000Z',
    );
    const calls: Array<{ command: string; options: AnyRecord }> = [];
    let headroomListener: (status: { hasHeadroom: boolean; earliestResetAt: string | null }) => void = () => {
      throw new Error('recovery listener was not registered');
    };
    const socket = new TestSocket();
    handleChatConnection(socket as unknown as WebSocket, request, {
      runtime: {
        hasRuntime: () => true,
        async run(_provider, command, options, writer: ProviderRuntimeWriter) {
          calls.push({ command, options });
          if (calls.length === 1) {
            writer.send({ kind: 'error', provider: 'claude', content: "You've hit your session limit" });
            writer.send({ kind: 'complete', provider: 'claude', exitCode: 1 });
          } else {
            writer.send({ kind: 'text', provider: 'claude', role: 'assistant', content: 'recovered' });
            writer.send({ kind: 'complete', provider: 'claude', exitCode: 0 });
          }
        },
        async abort() { return true; },
        resolveToolApproval() {},
        getPendingApprovalsForSession: () => [],
      },
      accountLimitRecovery: {
        async refresh() {
          return { hasHeadroom: false, earliestResetAt: '2099-08-27T13:00:00.000Z' };
        },
        subscribe(listener) {
          headroomListener = listener;
          return () => undefined;
        },
      },
    });

    try {
      await socket.receive({
        type: 'chat.send',
        sessionId: 'interactive-limit',
        content: 'finish this turn',
        options: { effort: 'high' },
      });

      const frames = socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
      assert.equal(calls.length, 1);
      assert.equal(queuedMessagesDb.getHead('interactive-limit')?.id, 'queued-after-limit');
      assert.equal(
        frames.some((frame) => frame.kind === 'status' && frame.text === 'waiting_for_session_window'),
        true,
      );
      assert.equal(
        frames.some((frame) => frame.messageOrigin === 'watchdog' && String(frame.content).startsWith('waiting for a session window')),
        true,
      );

      headroomListener({ hasHeadroom: true, earliestResetAt: null });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(calls.length, 2);
      assert.equal(calls[1]?.command, 'finish this turn');
      assert.equal(calls[1]?.options.sessionId, 'interactive-limit');
      assert.equal(queuedMessagesDb.getHead('interactive-limit')?.id, 'queued-after-limit');
    } finally {
      connectedClients.delete(socket as unknown as WebSocket);
    }
  });
});
