import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findWorkerFollowTarget,
  preserveWorkerSessionSelection,
  selectedRunKeepsAutoFollow,
  sessionUpsertNeedsRunRefresh,
  shouldFollowWorkerRun,
  workerSessionPinUntil,
  WORKER_SESSION_PIN_MS,
} from './workerRunFollow';

test('a pipelined verify run never replaces the build follow target', () => {
  const verify = { sessionId: 'verify-1', chainStage: 'verify' as const };
  const build = { sessionId: 'build-2' };
  const target = findWorkerFollowTarget([verify, build]);

  assert.equal(target, build);
  assert.equal(selectedRunKeepsAutoFollow(build, target), true);
  assert.equal(selectedRunKeepsAutoFollow(verify, target), false);
});

test('a new build follows immediately except during the one-minute intentional pin', () => {
  const now = 1_000;
  const oldBuild = { sessionId: 'build-1', startedAt: now };
  const newBuild = { sessionId: 'build-2', startedAt: new Date(now + 100).toISOString() };
  const verify = { sessionId: 'verify-1', chainStage: 'verify' as const, startedAt: now + 200 };
  // Recent transcript activity can put an older run first in the API array;
  // the honest start time still decides which build owns the pane.
  const target = findWorkerFollowTarget([oldBuild, verify, newBuild]);
  const pinnedUntil = workerSessionPinUntil(oldBuild, target, now);

  assert.equal(target, newBuild, 'the verifier is invisible to automatic follow');
  assert.equal(pinnedUntil, now + WORKER_SESSION_PIN_MS);
  assert.equal(shouldFollowWorkerRun(target, oldBuild.sessionId, pinnedUntil, pinnedUntil - 1), false);
  assert.equal(shouldFollowWorkerRun(target, oldBuild.sessionId, pinnedUntil, pinnedUntil), true);
  assert.equal(workerSessionPinUntil(newBuild, target, now), 0, 'selecting the live build clears the pin');
});

test('selecting the already rendered session preserves object identity', () => {
  const rendered = { id: 'build-2', provider: 'codex' };
  const duplicate = { id: 'build-2', provider: 'codex' };
  const other = { id: 'build-3', provider: 'codex' };

  assert.equal(preserveWorkerSessionSelection(rendered, duplicate), rendered);
  assert.equal(preserveWorkerSessionSelection(rendered, other), other);
});

test('only an unknown session upsert refreshes the run navigator immediately', () => {
  const known = new Set(['build-2', 'verify-1']);

  assert.equal(sessionUpsertNeedsRunRefresh('build-2', known), false);
  assert.equal(sessionUpsertNeedsRunRefresh('build-3', known), true);
  assert.equal(sessionUpsertNeedsRunRefresh(null, known), true);
});
