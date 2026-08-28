import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { mergeMemoryUpdateRows, normalizedToChatMessages } from './useChatMessages';

const message = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  id: 'message-1',
  sessionId: 'session-1',
  timestamp: '2026-08-27T12:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  ...overrides,
});

test('memory update diffs survive both live conversion and persisted-row merging', () => {
  const diffs = { 'STATE.md': ['+ The real changed line', '- The old line'] };
  const live = normalizedToChatMessages([
    message({ kind: 'memory_update', memoryFiles: ['STATE.md'], memoryDiffs: diffs, durationMs: 2_500 }),
  ]);
  assert.deepEqual(live[0].memoryDiffs, diffs);
  assert.equal(live[0].durationMs, 2_500);

  const persisted = mergeMemoryUpdateRows([], [{
    id: 7,
    files: ['STATE.md'],
    diffs,
    durationMs: 2_600,
    createdAt: '2026-08-27T12:00:03.000Z',
  }]);
  assert.deepEqual(persisted[0].memoryDiffs, diffs);
  assert.equal(persisted[0].durationMs, 2_600);
});

test('tool and thinking rows derive exact durations from provider timestamps', () => {
  const rows = normalizedToChatMessages([
    message({ id: 'user', kind: 'text', role: 'user', content: 'Start' }),
    message({ id: 'thinking', kind: 'thinking', content: 'Reasoning', timestamp: '2026-08-27T12:00:12.400Z' }),
    message({ id: 'tool', kind: 'tool_use', toolId: 'tool-1', toolName: 'Read', toolInput: {}, timestamp: '2026-08-27T12:00:13.000Z' }),
    message({ id: 'result', kind: 'tool_result', toolId: 'tool-1', content: 'done', timestamp: '2026-08-27T12:00:25.400Z' }),
  ]);
  assert.equal(rows.find((row) => row.isThinking)?.durationMs, 12_400);
  assert.equal(rows.find((row) => row.isToolUse)?.durationMs, 12_400);
});

test('a confirmed interrupt settles every unresolved tool and agent row in that turn', () => {
  const rows = normalizedToChatMessages([
    message({ id: 'user', kind: 'text', role: 'user', content: 'Start' }),
    message({ id: 'agent', kind: 'tool_use', toolId: 'task-1', toolName: 'Task', toolInput: {}, timestamp: '2026-08-27T12:00:01.000Z' }),
    message({ id: 'interrupt', kind: 'text', role: 'user', content: '', isInterruptMarker: true, timestamp: '2026-08-27T12:00:08.500Z' }),
  ]);
  const agent = rows.find((row) => row.isSubagentContainer);
  assert.equal(agent?.durationMs, 7_500);
  assert.equal(agent?.subagentState?.isComplete, true);
  assert.equal(rows.at(-1)?.isInterruptMarker, true);
});

test('watchdog origin metadata survives into the chat row model', () => {
  const rows = normalizedToChatMessages([
    message({ role: 'user', content: 'Check the chain.', messageOrigin: 'watchdog' }),
  ]);
  assert.equal(rows[0].messageOrigin, 'watchdog');
  assert.equal(rows[0].type, 'user');
});
