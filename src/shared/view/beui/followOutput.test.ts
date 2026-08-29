import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyGestureSettled,
  applyReaderGesture,
  applyRepinStarted,
  applyScroll,
  createFollowState,
  shouldRepin,
} from './followOutput';

const THRESHOLD = 56;

test('a reader gesture releases follow before their scroll event lands', () => {
  // The exact race behind Willem's report: a wheel up, then a streamed row
  // resizing the content before the browser dispatched the scroll event.
  let state = createFollowState(true);
  state = applyReaderGesture(state);
  assert.equal(shouldRepin(state, true), false);
});

test('rows arriving while the reader is scrolled up never repin', () => {
  let state = applyReaderGesture(createFollowState(true));
  state = applyScroll(state, 800, THRESHOLD);
  assert.equal(state.following, false);
  for (let row = 0; row < 3; row += 1) {
    assert.equal(shouldRepin(state, true), false);
  }
});

test('follow returns when the reader scrolls back to the live edge', () => {
  let state = applyScroll(applyReaderGesture(createFollowState(true)), 800, THRESHOLD);
  assert.equal(state.following, false);
  state = applyScroll(state, 0, THRESHOLD);
  assert.equal(state.following, true);
  assert.equal(state.departed, false);
  assert.equal(shouldRepin(state, true), true);
});

test('the tail of the engine own repin is not the reader leaving', () => {
  // ui13 job 15: a 2000px landing outlives any fixed guard timer, so only
  // arrival clears the programmatic flag.
  let state = applyRepinStarted(createFollowState(true));
  state = applyScroll(state, 1400, THRESHOLD);
  assert.equal(state.following, true);
  state = applyScroll(state, 600, THRESHOLD);
  assert.equal(state.following, true);
  state = applyScroll(state, 4, THRESHOLD);
  assert.equal(state.following, true);
  assert.equal(state.programmatic, false);
});

test('a reader gesture during a repin still wins', () => {
  let state = applyRepinStarted(createFollowState(true));
  state = applyReaderGesture(state);
  assert.equal(state.programmatic, false);
  state = applyScroll(state, 900, THRESHOLD);
  assert.equal(state.following, false);
});

test('a gesture that moved nothing settles back on the real distance', () => {
  const atEdge = applyGestureSettled(applyReaderGesture(createFollowState(true)), 0, THRESHOLD);
  assert.deepEqual(atEdge, { following: true, programmatic: false, departed: false });

  const scrolledUp = applyGestureSettled(applyReaderGesture(createFollowState(true)), 900, THRESHOLD);
  assert.deepEqual(scrolledUp, { following: false, programmatic: false, departed: false });
});

test('follow output off never repins', () => {
  assert.equal(shouldRepin(createFollowState(true), false), false);
});
