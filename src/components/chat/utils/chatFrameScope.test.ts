import assert from 'node:assert/strict';
import test from 'node:test';

import { frameTargetsSession } from './chatFrameScope';

test('a websocket frame for session A is consumed by A and never session B rows', () => {
  assert.equal(frameTargetsSession('session-a', 'session-a'), true);
  assert.equal(frameTargetsSession('session-a', 'session-b'), false);
  assert.equal(frameTargetsSession('session-a', null), false);
  assert.equal(frameTargetsSession(null, 'session-b'), false);
});
