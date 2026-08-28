import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_SESSION_MESSAGE_LIMIT,
  HIDDEN_SESSION_MESSAGE_LIMIT,
  SESSION_SLOT_CACHE_LIMIT,
  boundedTail,
  touchSessionSlot,
} from './sessionSlotCache';

test('session slots evict the least-recently-used hidden transcript', () => {
  const slots = new Map<string, { id: string }>();
  const touch = (id: string, active: string | null = id) =>
    touchSessionSlot(slots, id, () => ({ id }), active);

  touch('a');
  touch('b');
  touch('c');
  touch('a');
  touch('d');

  assert.equal(slots.size, SESSION_SLOT_CACHE_LIMIT);
  assert.deepEqual([...slots.keys()], ['c', 'a', 'd']);
  assert.equal(slots.has('b'), false);
});

test('incoming hidden-session frames cannot evict the transcript in view', () => {
  const slots = new Map<string, { id: string }>();
  const touch = (id: string, active: string | null) =>
    touchSessionSlot(slots, id, () => ({ id }), active);

  touch('visible', 'visible');
  touch('recent', 'visible');
  touch('older', 'visible');
  touch('background-frame', 'visible');

  assert.equal(slots.has('visible'), true);
  assert.equal(slots.has('recent'), false);
  assert.deepEqual([...slots.keys()], ['visible', 'older', 'background-frame']);
});

test('returning to an evicted session creates a fresh slot for a server refetch', () => {
  const slots = new Map<string, { generation: number }>();
  let generation = 0;
  const touch = (id: string, active: string | null = id) =>
    touchSessionSlot(slots, id, () => ({ generation: ++generation }), active);

  const first = touch('a');
  touch('b');
  touch('c');
  touch('d');
  assert.equal(slots.has('a'), false);

  const returned = touch('a');
  assert.notEqual(returned, first);
  assert.equal(returned.generation, 5);
});

test('a hidden transcript retains only its tiny recent tail', () => {
  const rows = Array.from({ length: 12 }, (_, index) => index + 1);
  assert.deepEqual(
    boundedTail(rows, HIDDEN_SESSION_MESSAGE_LIMIT),
    [12],
  );
  const shortTail = rows.slice(0, 1);
  assert.equal(boundedTail(shortTail, HIDDEN_SESSION_MESSAGE_LIMIT), shortTail);
});

test('the visible realtime tail shares the transcript DOM budget', () => {
  const rows = Array.from(
    { length: ACTIVE_SESSION_MESSAGE_LIMIT + 4 },
    (_, index) => `row-${index}`,
  );

  const bounded = boundedTail(rows, ACTIVE_SESSION_MESSAGE_LIMIT);

  assert.equal(bounded.length, ACTIVE_SESSION_MESSAGE_LIMIT);
  assert.equal(bounded[0], 'row-4');
  assert.equal(bounded.at(-1), `row-${ACTIVE_SESSION_MESSAGE_LIMIT + 3}`);
});
