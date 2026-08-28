import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import JobsSidebar, { type ChainSnapshot, type JobGroup } from './JobsSidebar';

test('the jobs column renders the paused state on the current chain row', () => {
  const chain: ChainSnapshot = {
    slug: 'pause-stub',
    projectPath: '/workspace/pause-stub',
    status: 'paused',
    phases: 3,
    currentPhase: 2,
    phaseActive: false,
    manifest: [
      { name: 'One', tasks: [], kind: 'phase', commitHash: 'abc1234' },
      { name: 'Two', tasks: [], kind: 'phase' },
      { name: 'Three', tasks: [], kind: 'phase' },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };
  const groups: JobGroup[] = [{ chain, run: null, sessions: {}, startedAt: 1 }];

  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups,
    activeSessionId: null,
    onOpenSession: () => undefined,
  }));
  assert.match(markup, /data-chain="pause-stub" data-kind="phase" data-status="paused"/);
  assert.match(markup, /data-slot="jobs-sidebar-paused-icon" aria-label="Paused"/);
});

test('a committed job holds its check behind a centered spinner while verify runs', () => {
  const chain: ChainSnapshot = {
    slug: 'verify-stub',
    projectPath: '/workspace/verify-stub',
    status: 'running',
    phases: 2,
    currentPhase: 2,
    phaseActive: true,
    manifest: [
      {
        name: 'Build complete',
        tasks: ['One', 'Two'],
        kind: 'phase',
        done: 2,
        commitHash: 'abc1234',
        verify: 'running',
        verifyStartedAt: Date.now(),
      },
      { name: 'Next build', tasks: [], kind: 'phase' },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };
  const groups: JobGroup[] = [{ chain, run: null, sessions: {}, startedAt: 1 }];

  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups,
    activeSessionId: null,
    onOpenSession: () => undefined,
  }));

  assert.match(markup, /data-slot="job-verify-spinner"/);
  assert.equal((markup.match(/data-done="true"/g) ?? []).length, 2);
});
