import assert from 'node:assert/strict';
import test from 'node:test';

import { quadraticBezier } from './BounceIndicator';

test('selection changes follow the restored curved bounce path', () => {
  const start = { x: 20, y: 12 };
  const control = { x: 4, y: 30 };
  const destination = { x: 20, y: 52 };

  assert.deepEqual(
    {
      x: quadraticBezier(start.x, control.x, destination.x, 0),
      y: quadraticBezier(start.y, control.y, destination.y, 0),
    },
    start,
  );
  assert.deepEqual(
    {
      x: quadraticBezier(start.x, control.x, destination.x, 1),
      y: quadraticBezier(start.y, control.y, destination.y, 1),
    },
    destination,
  );

  const midpoint = {
    x: quadraticBezier(start.x, control.x, destination.x, 0.5),
    y: quadraticBezier(start.y, control.y, destination.y, 0.5),
  };
  assert.ok(midpoint.x < start.x, 'the intermediate frame arcs sideways');
  assert.ok(midpoint.y > start.y && midpoint.y < destination.y, 'the dot travels toward the new row');
});
