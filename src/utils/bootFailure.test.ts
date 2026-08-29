import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBootFailure } from './bootFailure';

// A reopened handoff successor: the pane holds no boot record of its own, so
// everything the view shows comes off the session payload (ui17 job 21).
const persistedFailedSuccessor = {
  bootPhase: 'idle' as const,
  bootReason: null,
  viewingBootSession: false,
  sessionBootState: 'failed',
  sessionBootError: 'The handoff turn was stopped before it finished.',
  hasReadyAssistantText: false,
};

test('a persisted failed successor shows the failed view and its own line on cold load', () => {
  const { failed, reason } = resolveBootFailure(persistedFailedSuccessor);

  assert.equal(failed, true);
  assert.equal(reason, 'The handoff turn was stopped before it finished.');
});

test('a failure with no line of its own falls through to the generic copy', () => {
  const { failed, reason } = resolveBootFailure({
    ...persistedFailedSuccessor,
    sessionBootError: '   ',
  });

  assert.equal(failed, true);
  assert.equal(reason, null);
});

test('the live frame line wins over the persisted one while the pane owns the boot', () => {
  const { failed, reason } = resolveBootFailure({
    bootPhase: 'failed',
    bootReason: 'The memory repo was not pushed, so the new planner was not started.',
    viewingBootSession: true,
    sessionBootState: null,
    sessionBootError: 'stale line',
    hasReadyAssistantText: false,
  });

  assert.equal(failed, true);
  assert.equal(reason, 'The memory repo was not pushed, so the new planner was not started.');
});

test('a session that became usable despite the stamp is not a failed boot', () => {
  const { failed } = resolveBootFailure({
    ...persistedFailedSuccessor,
    hasReadyAssistantText: true,
  });

  assert.equal(failed, false);
});

test('a retry in flight shows the loader, not the failure', () => {
  const { failed } = resolveBootFailure({
    ...persistedFailedSuccessor,
    bootPhase: 'booting',
    viewingBootSession: true,
  });

  assert.equal(failed, false);
});
