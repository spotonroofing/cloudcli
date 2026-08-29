import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeUnitKey,
  activeWorkerChain,
  drawerOpenKeys,
  findWorkerFollowTarget,
  preserveWorkerSessionSelection,
  selectedRunKeepsAutoFollow,
  sessionUpsertNeedsRunRefresh,
  shouldFollowWorkerRun,
  workerPaneJobTitle,
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

test('job drawers follow a unit start, a hand-opened drawer, and the next unit start (ui18 job 4)', () => {
  const stub = (currentPhase: number, phaseActive: boolean, status = 'running') => ({
    slug: 'follow-stub',
    status,
    currentPhase,
    phaseActive,
    startedAt: 1,
    manifest: [{ name: 'One' }, { name: 'Two' }],
  });
  const drawers = ['follow-stub:1', 'follow-stub:2'];

  // Unit 1 starts: its drawer is the open one.
  let boundary = activeUnitKey([stub(1, true)]);
  assert.deepEqual(drawerOpenKeys(drawers, {}, boundary), ['follow-stub:1']);

  // Between boundaries Willem opens unit 2's drawer by hand; it is respected.
  const byHand = { 'follow-stub:2': true };
  assert.deepEqual(drawerOpenKeys(drawers, byHand, boundary), ['follow-stub:1', 'follow-stub:2']);

  // Unit 1 ends: the column is at a boundary, the sidebar drops the overrides,
  // and no drawer is forced open.
  boundary = activeUnitKey([stub(1, false)]);
  assert.equal(boundary, null);
  assert.deepEqual(drawerOpenKeys(drawers, {}, boundary), []);

  // Unit 2 starts: the work moved, and so did the open drawer.
  boundary = activeUnitKey([stub(2, true)]);
  assert.deepEqual(drawerOpenKeys(drawers, {}, boundary), ['follow-stub:2']);

  // A chain that stopped is not work in progress; nothing is held open for it.
  assert.equal(activeUnitKey([stub(2, true, 'stopped')]), null);
});

test('the worker pane title names the running unit, else the last one that landed', () => {
  const running = {
    slug: 'ui18',
    status: 'running',
    currentPhase: 2,
    phaseActive: true,
    startedAt: 20,
    manifest: [
      { name: 'Promote waits for the job', commitHash: 'abc1234' },
      { name: 'Promoted line in jobs' },
    ],
  };
  const finished = {
    slug: 'ui17',
    status: 'completed',
    currentPhase: 2,
    phaseActive: false,
    startedAt: 10,
    manifest: [
      { name: 'Runner reloads', commitHash: 'aaa1111' },
      { name: 'Wakes land', commitHash: 'bbb2222' },
    ],
  };

  assert.equal(activeWorkerChain([finished, running]), running);
  assert.deepEqual(workerPaneJobTitle([finished, running], 'ui18'), {
    name: 'Promoted line in jobs',
    state: 'running',
  });
  // A chain that died without its terminal event stays "running" for ever; the
  // chain the pane actually follows outranks it.
  const stale = { ...running, slug: 'stale-stub', currentPhase: 1, startedAt: 99, manifest: [{ name: 'Stale stub' }] };
  assert.equal(activeWorkerChain([running, stale], 'ui18'), running);
  assert.equal(workerPaneJobTitle([running, stale], 'ui18')?.name, 'Promoted line in jobs');
  assert.equal(workerPaneJobTitle([running, stale], null)?.name, 'Stale stub', 'no followed chain, newest wins');
  // Nothing running: the followed chain's last landed unit, in the done treatment.
  assert.deepEqual(workerPaneJobTitle([finished], 'ui17'), { name: 'Wakes land', state: 'done' });
  // A run belonging to no chain keeps the pane's own session title.
  assert.equal(workerPaneJobTitle([finished], null), null);
});
