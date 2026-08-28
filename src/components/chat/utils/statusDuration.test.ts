import assert from 'node:assert/strict';
import test from 'node:test';

import { formatStatusDuration, statusStartedAt } from './statusDuration';

test('status durations keep decisecond precision and tabular-friendly units', () => {
  assert.equal(formatStatusDuration(12_440), '12.4s');
  assert.equal(formatStatusDuration(60_050), '1m 0.1s');
  assert.equal(formatStatusDuration(72_440), '1m 12.4s');
  assert.equal(formatStatusDuration(3_660_000), '1h 1m');
});

test('statusStartedAt rejects invalid timestamps', () => {
  assert.equal(statusStartedAt('2026-08-27T12:00:00.000Z'), new Date('2026-08-27T12:00:00.000Z').getTime());
  assert.equal(statusStartedAt('not-a-time'), null);
  assert.equal(statusStartedAt(undefined), null);
});
