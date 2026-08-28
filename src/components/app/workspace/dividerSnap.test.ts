import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dividerMinimumFractions,
  flexWeightsForVisualFraction,
  reachableSnapStops,
} from './dividerSnap';

test('pane snap stops honor each pane minimum instead of a shared constant', () => {
  const minimums = dividerMinimumFractions(200, 280, 574);

  assert.deepEqual(reachableSnapStops(minimums), [0.5]);
  assert.ok(minimums.leading < minimums.trailing);
});

test('an undersized pair normalizes its minimums to one stable boundary', () => {
  const minimums = dividerMinimumFractions(160, 160, 300);

  assert.deepEqual(minimums, { leading: 0.5, trailing: 0.5 });
  assert.deepEqual(reachableSnapStops(minimums), [0.5]);
});

test('visual snap fractions account for a jobs flex basis', () => {
  const evenVisibleThirds = flexWeightsForVisualFraction(1 / 3, 2, 575, 0, 575 / 3);
  assert.ok(Math.abs(evenVisibleThirds.leading - 1) < 0.001);
  assert.ok(Math.abs(evenVisibleThirds.trailing - 1) < 0.001);

  const centeredOuterPanes = flexWeightsForVisualFraction(0.5, 2, 575, 0, 575 / 3);
  assert.ok(Math.abs(centeredOuterPanes.leading - 1.5) < 0.001);
  assert.ok(Math.abs(centeredOuterPanes.trailing - 0.5) < 0.001);
});
