import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findWorkerFollowTarget,
  preserveWorkerSessionSelection,
  selectedRunKeepsAutoFollow,
  sessionUpsertNeedsRunRefresh,
} from './workerRunFollow';

test('a pipelined verify run never replaces the build follow target', () => {
  const verify = { sessionId: 'verify-1', chainStage: 'verify' as const };
  const build = { sessionId: 'build-2' };
  const target = findWorkerFollowTarget([verify, build]);

  assert.equal(target, build);
  assert.equal(selectedRunKeepsAutoFollow(build, target), true);
  assert.equal(selectedRunKeepsAutoFollow(verify, target), false);
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
