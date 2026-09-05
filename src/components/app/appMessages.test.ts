import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_APP_MESSAGES,
  addAppMessage,
  dismissAppMessage,
  failureDetail,
  responseFailureDetail,
  type AppMessage,
} from './appMessages';

const message = (id: string, title = id): AppMessage => ({ id, title, detail: null });

test('a repeat of the same failure replaces its entry instead of stacking', () => {
  const first = addAppMessage([], message('settings-save', 'Settings did not save'));
  const second = addAppMessage(first, { id: 'settings-save', title: 'Settings did not save', detail: '503' });

  assert.equal(second.length, 1);
  assert.equal(second[0].detail, '503');
});

test('the strip keeps the newest three failures', () => {
  const messages = ['a', 'b', 'c', 'd'].reduce<AppMessage[]>(
    (list, id) => addAppMessage(list, message(id)),
    [],
  );

  assert.equal(messages.length, MAX_APP_MESSAGES);
  assert.deepEqual(messages.map((entry) => entry.id), ['b', 'c', 'd']);
});

test('dismissing removes only its own entry', () => {
  const messages = addAppMessage(addAppMessage([], message('a')), message('b'));

  assert.deepEqual(dismissAppMessage(messages, 'a').map((entry) => entry.id), ['b']);
});

test('failureDetail reads a thrown Error and rejects empty text', () => {
  assert.equal(failureDetail(new Error('Chain "x" is not running.')), 'Chain "x" is not running.');
  assert.equal(failureDetail('  '), null);
  assert.equal(failureDetail(undefined), null);
});

test('a failed response reports the server reason, else its status', async () => {
  assert.equal(
    await responseFailureDetail({ status: 409, json: async () => ({ error: 'Chain "audit1" is not running.' }) }),
    'Chain "audit1" is not running.',
  );
  assert.equal(
    await responseFailureDetail({
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('not json'); },
    }),
    '502 Bad Gateway',
  );
});
