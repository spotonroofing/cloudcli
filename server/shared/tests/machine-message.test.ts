import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMachineMessage, wrapMachineMessage } from '@/shared/utils.js';

test('machine message origin round-trips without inspecting prompt wording', () => {
  const prompt = 'The same words Willem could have typed himself.';
  const wrapped = wrapMachineMessage(prompt, 'watchdog');
  assert.deepEqual(parseMachineMessage(wrapped), { origin: 'watchdog', content: prompt });
  assert.equal(parseMachineMessage(prompt), null);
  assert.equal(parseMachineMessage(wrapped.replace('watchdog', 'unknown')), null);
});

test('machine message parsing survives the whitespace-flattened CLI shape', () => {
  const wrapped = wrapMachineMessage('Check chain state.\nDo not act blind.', 'watchdog');
  const flattened = wrapped.replace(/\s*\n\s*/g, ' ');
  assert.deepEqual(parseMachineMessage(flattened), {
    origin: 'watchdog',
    content: 'Check chain state. Do not act blind.',
  });
});

test('machine message parsing accepts the legacy envelope for one release', () => {
  const legacyStem = ['cloud', 'cli'].join('');
  const wrapped = `<${legacyStem}-message-origin>watchdog</${legacyStem}-message-origin>\n`
    + `<${legacyStem}-machine-message>Keep compatibility.</${legacyStem}-machine-message>`;
  assert.deepEqual(parseMachineMessage(wrapped), {
    origin: 'watchdog',
    content: 'Keep compatibility.',
  });
});
