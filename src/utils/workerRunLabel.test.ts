import assert from 'node:assert/strict';
import test from 'node:test';

import { workerRunLabel } from './workerRunLabel';

test('chain-less worker labels use kind, short model, and Eastern start time', () => {
  assert.equal(workerRunLabel({
    origin: 'direct',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    startedAt: '2026-08-27T21:40:00.000Z',
  }), 'One-off, Sol, 5:40 pm');
  assert.equal(workerRunLabel({
    origin: 'external',
    provider: 'claude',
    model: 'claude-opus-5',
    startedAt: '2026-08-27T13:05:00.000Z',
  }), 'Headless, Opus, 9:05 am');
});
