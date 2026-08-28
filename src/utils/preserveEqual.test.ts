import assert from 'node:assert/strict';
import test from 'node:test';

import { preserveJsonEqual } from './preserveEqual';

test('an unchanged poll snapshot preserves identity and a changed snapshot replaces it', () => {
  const previous = [{ sessionId: 'a', state: 'running', nested: { done: 2 } }];
  const unchanged = [{ sessionId: 'a', state: 'running', nested: { done: 2 } }];
  const changed = [{ sessionId: 'a', state: 'finished', nested: { done: 2 } }];

  assert.equal(preserveJsonEqual(previous, unchanged), previous);
  assert.equal(preserveJsonEqual(previous, changed), changed);
});
