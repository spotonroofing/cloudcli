import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { AuthenticatedWebSocketRequest, ProviderRuntimeWriter } from '@/shared/types.js';

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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'handoff-follow-through-'));
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

const HANDOFF_COMMAND = [
  '<command-message>End this planner session</command-message>',
  '<command-name>/handoff</command-name>',
  '<command-args></command-args>',
  '',
  'Run the planner handoff for this session.',
].join('\n');

type HookLog = {
  events: string[];
  starts: Array<{ sessionId: string; projectPath: string }>;
  completions: Array<{
    sessionId: string;
    projectPath: string;
    successorSessionId: string | null;
    failureReason: string | null;
  }>;
};

/**
 * A chat connection whose handoff hooks record their order alongside the
 * runtime call, so a test can prove the successor is reserved before /handoff
 * runs rather than after it.
 */
function connectWithHookLog(
  socket: TestSocket,
  runtimeBehavior: (writer: ProviderRuntimeWriter) => void | Promise<void> = () => undefined,
): HookLog {
  const log: HookLog = { events: [], starts: [], completions: [] };
  handleChatConnection(socket as unknown as WebSocket, request, {
    runtime: {
      hasRuntime: () => true,
      async run(_provider, _command, _options, writer: ProviderRuntimeWriter) {
        log.events.push('runtime');
        await runtimeBehavior(writer);
      },
      async abort() { return true; },
      resolveToolApproval() {},
      getPendingApprovalsForSession: () => [],
    },
    onPlannerHandoffTurnStart: (input) => {
      log.events.push('start');
      log.starts.push(input);
      return 'successor-session';
    },
    onPlannerHandoffTurnComplete: (input) => {
      log.events.push('complete');
      log.completions.push(input);
    },
  });
  return log;
}

test('a planner /handoff reserves its successor before the turn runs and boots it when the turn ends clean', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/handoff-project';
    sessionsDb.createAppSession('planner-session', 'claude', projectPath, 'Planner', 'planner');

    const socket = new TestSocket();
    const log = connectWithHookLog(socket);

    try {
      await socket.receive({ type: 'chat.send', sessionId: 'planner-session', content: HANDOFF_COMMAND });
    } finally {
      socket.emit('close');
    }

    assert.deepEqual(log.events, ['start', 'runtime', 'complete']);
    assert.deepEqual(log.starts, [{ sessionId: 'planner-session', projectPath }]);
    assert.deepEqual(log.completions, [{
      sessionId: 'planner-session',
      projectPath,
      successorSessionId: 'successor-session',
      failureReason: null,
    }]);
  });
});

test('a handoff turn that errors keeps its reserved successor and says what went wrong', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/handoff-project';
    sessionsDb.createAppSession('planner-session', 'claude', projectPath, 'Planner', 'planner');

    const socket = new TestSocket();
    const log = connectWithHookLog(socket, () => {
      throw new Error('the handoff turn blew up');
    });

    try {
      await socket.receive({ type: 'chat.send', sessionId: 'planner-session', content: HANDOFF_COMMAND });
    } finally {
      socket.emit('close');
    }

    assert.equal(log.completions.length, 1);
    assert.equal(log.completions[0].successorSessionId, 'successor-session');
    assert.match(log.completions[0].failureReason ?? '', /ended with an error/);
  });
});

test('only a planner session typing or clicking /handoff reserves a successor', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/handoff-project';
    sessionsDb.createAppSession('plain-chat', 'claude', projectPath, 'Side chat', null);
    sessionsDb.createAppSession('planner-boot', 'claude', projectPath, 'Planner', 'planner');

    const socket = new TestSocket();
    const log = connectWithHookLog(socket);

    try {
      await socket.receive({ type: 'chat.send', sessionId: 'plain-chat', content: HANDOFF_COMMAND });
      // The auto-sent /planner boot of a fresh successor must never reserve
      // another successor of its own.
      await socket.receive({
        type: 'chat.send',
        sessionId: 'planner-boot',
        content: HANDOFF_COMMAND,
        options: { bootPrompt: true },
      });
    } finally {
      socket.emit('close');
    }

    assert.deepEqual(log.starts, []);
    assert.deepEqual(log.completions, []);
  });
});
