import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_SOUND_OPTIONS,
  completionSoundRoleFor,
  getCompletionSound,
} from './notificationSound';

test('completion sound catalog is small, distinct, and seeds different pane sounds', () => {
  const ids = COMPLETION_SOUND_OPTIONS.map((option) => option.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(getCompletionSound('planner'), getCompletionSound('worker'));
});

test('completion events use the planner sound only for planner-owned panes', () => {
  assert.equal(completionSoundRoleFor('planner', null), 'planner');
  assert.equal(completionSoundRoleFor(null, 'planner'), 'planner');
  assert.equal(completionSoundRoleFor('dispatch', 'direct'), 'worker');
  assert.equal(completionSoundRoleFor(null, null), 'worker');
});
