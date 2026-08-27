import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
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

test('planner turns receive the project allowlist and dispatch turns receive the empty MCP policy', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/context-project';
    sessionsDb.createAppSession('planner-session', 'claude', projectPath, 'Planner', 'planner');
    sessionsDb.createAppSession('dispatch-session', 'claude', projectPath, 'Dispatch', 'dispatch');

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
      await socket.receive({ type: 'chat.send', sessionId: 'dispatch-session', content: 'dispatch turn' });

      assert.equal(calls[0]?.command, 'planner turn');
      assert.equal(calls[0]?.options.mcpPolicy, 'planner');
      assert.deepEqual(calls[0]?.options.allowedMcpServers, ['spoton-core', 'playwright']);
      assert.equal(calls[1]?.command, 'dispatch turn');
      assert.equal(calls[1]?.options.mcpPolicy, 'none');
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
