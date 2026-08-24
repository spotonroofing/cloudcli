import assert from 'node:assert/strict';
import test from 'node:test';

import { commandDisplayText, parseCommandMessage } from '@/shared/command-message.js';

test('command-message: composer wrapper parses name, description, args, and body', () => {
  const wrapped = [
    '<command-message>End this planner session - refresh STATE.md</command-message>',
    '<command-name>/handoff</command-name>',
    '<command-args></command-args>',
    '',
    'Run the planner handoff for this session.',
    'Second line of the expanded prompt.',
  ].join('\n');

  const parsed = parseCommandMessage(wrapped);
  assert.ok(parsed);
  assert.equal(parsed.name, '/handoff');
  assert.equal(parsed.description, 'End this planner session - refresh STATE.md');
  assert.equal(parsed.args, '');
  assert.equal(parsed.body, 'Run the planner handoff for this session.\nSecond line of the expanded prompt.');
  assert.equal(commandDisplayText(parsed), '/handoff');
});

test('command-message: args join the display text and CLI rows have no body', () => {
  const cliRow = '<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>src/index.ts</command-args>';
  const parsed = parseCommandMessage(cliRow);
  assert.ok(parsed);
  assert.equal(parsed.body, '');
  assert.equal(commandDisplayText(parsed), '/review src/index.ts');
});

test('command-message: ordinary messages parse to null', () => {
  assert.equal(parseCommandMessage('Just a normal message with <files_input> nothing.'), null);
});
