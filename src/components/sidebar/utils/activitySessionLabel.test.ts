import assert from 'node:assert/strict';
import test from 'node:test';

import { meaningfulActivityDetail } from './activitySessionLabel';

test('activity labels omit missing-value dash sentinels but keep real phase names', () => {
  assert.equal(meaningfulActivityDetail('-'), null);
  assert.equal(meaningfulActivityDetail('--'), null);
  assert.equal(meaningfulActivityDetail(' — '), null);
  assert.equal(meaningfulActivityDetail('Footer activity icons'), 'Footer activity icons');
});
