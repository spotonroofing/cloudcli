import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeldPromptStream } from '@/modules/providers/list/claude/claude-runtime.provider.js';

const userMessage = (content: string) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: null,
});

test('held prompt stream yields the prompt, then pushed steers, then ends on release', async () => {
  const held = createHeldPromptStream([userMessage('first')]);
  const seen: string[] = [];
  const consumed = (async () => {
    for await (const message of held.stream) {
      seen.push(message.message.content);
    }
  })();

  // Let the generator yield the prompt and park.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, ['first']);

  assert.equal(held.push(userMessage('steer')), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, ['first', 'steer']);

  held.release();
  await consumed;
  assert.deepEqual(seen, ['first', 'steer']);
  assert.equal(held.push(userMessage('too late')), false);
});

test('held prompt stream drains messages pushed before the consumer catches up', async () => {
  const held = createHeldPromptStream([userMessage('first')]);
  held.push(userMessage('a'));
  held.push(userMessage('b'));
  held.release();

  const seen: string[] = [];
  for await (const message of held.stream) {
    seen.push(message.message.content);
  }
  assert.deepEqual(seen, ['first', 'a', 'b']);
});
