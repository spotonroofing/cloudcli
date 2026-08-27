import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCommandMessage } from '../utils/commandMessage';

import { submitExpandedCommand } from './useChatComposerState';

test('expanded command submits directly without setting the composer input value', async () => {
  const composerValue = 'draft that belongs to the user';
  let prevented = false;
  let submittedContent = '';
  let preserveComposer = false;

  await submitExpandedCommand(async (event, submission) => {
    event.preventDefault();
    prevented = true;
    submittedContent = submission?.content ?? '';
    preserveComposer = submission?.preserveComposer ?? false;
  }, [
    '<command-message>Prepare a handoff</command-message>',
    '<command-name>/handoff</command-name>',
    '<command-args></command-args>',
    '',
    'Expanded command body',
  ].join('\n'));

  assert.equal(prevented, true);
  assert.equal(composerValue, 'draft that belongs to the user');
  assert.equal(preserveComposer, true);
  assert.deepEqual(parseCommandMessage(submittedContent), {
    name: '/handoff',
    description: 'Prepare a handoff',
    args: '',
    body: 'Expanded command body',
  });
});
