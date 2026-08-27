import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types';

import { groupConsecutiveTools, isToolGroupItem } from './toolGrouping';

const tool = (id: string): ChatMessage => ({
  id,
  type: 'assistant',
  content: '',
  timestamp: '2026-08-27T12:00:00.000Z',
  isToolUse: true,
  toolName: 'exec',
});

test('loaded consecutive tools group from their first render', () => {
  const messages = [tool('one'), tool('two')];
  const grouped = groupConsecutiveTools(messages, true, () => true);

  assert.equal(grouped.length, 1);
  assert.equal(isToolGroupItem(grouped[0]), true);
});

test('a live sibling does not regroup and remount an existing tool row', () => {
  const messages = [tool('one'), tool('two')];
  const grouped = groupConsecutiveTools(messages, true, (message) => message.id === 'one');

  assert.deepEqual(grouped, messages);
});
