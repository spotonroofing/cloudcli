import assert from 'node:assert/strict';
import test from 'node:test';

import { createPaneDragTracker } from './paneDropHighlight';

// A pane with three nested children, standing in for the real chat pane.
const pane = { id: 'pane' };
const childA = { id: 'a' };
const childB = { id: 'b' };
const childC = { id: 'c' };
const outside = { id: 'outside' };

const inPane = new Set<unknown>([pane, childA, childB, childC]);
const contains = (target: unknown) => inPane.has(target);

test('the highlight holds while the pointer crosses nested children', () => {
  const tracker = createPaneDragTracker(contains);
  const shown: boolean[] = [];

  // The browser fires dragenter on the element being entered and dragleave on
  // the one being left, in that order, for every hop.
  shown.push(tracker.enter(pane));
  shown.push(tracker.enter(childA));
  shown.push(tracker.leave(pane));
  shown.push(tracker.enter(childB));
  shown.push(tracker.leave(childA));
  shown.push(tracker.enter(childC));
  shown.push(tracker.leave(childB));

  assert.deepEqual(shown, [true, true, true, true, true, true, true]);
  // Mounted once: a single false-to-true edge, so the entrance never replays.
  assert.equal(shown.filter((value, index) => value && !(index > 0 && shown[index - 1])).length, 1);
  assert.equal(tracker.active, true);
});

test('leaving the pane for good drops the highlight', () => {
  const tracker = createPaneDragTracker(contains);
  tracker.enter(pane);
  tracker.enter(childA);
  tracker.leave(pane);

  assert.equal(tracker.leave(childA), false);
  assert.equal(tracker.active, false);
  assert.equal(tracker.leave(outside), false);
});

test('a repeated dragenter for one element still needs only its own leave', () => {
  const tracker = createPaneDragTracker(contains);
  tracker.enter(pane);
  tracker.enter(childA);
  tracker.enter(childA);

  assert.equal(tracker.leave(childA), true);
  assert.equal(tracker.leave(pane), false);
});

test('a child that leaves the DOM mid-drag stops holding the highlight', () => {
  const removable = { id: 'removable' };
  const live = new Set<unknown>([pane, removable]);
  const tracker = createPaneDragTracker((target) => live.has(target));

  tracker.enter(pane);
  tracker.enter(removable);
  live.delete(removable);

  assert.equal(tracker.leave(pane), false);
});

test('a drop or a drag that ends elsewhere clears the highlight', () => {
  const tracker = createPaneDragTracker(contains);
  tracker.enter(pane);
  tracker.enter(childA);

  assert.equal(tracker.end(), false);
  assert.equal(tracker.active, false);
});
