import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import JobsSidebar, { type ChainSnapshot, type JobGroup } from './JobsSidebar';

test('the jobs column holds its rows with the shared skeleton while the first snapshot loads', () => {
  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups: [],
    loading: true,
    activeSessionId: null,
    onOpenSession: () => undefined,
  }));

  assert.match(markup, /data-slot="jobs-sidebar-skeleton"/);
  assert.equal((markup.match(/data-slot="skeleton"/g) ?? []).length, 12);
});

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

test('a provider token total renders on both the job row and its drawer', () => {
  const chain: ChainSnapshot = {
    slug: 'tokens-stub',
    projectPath: '/workspace/tokens-stub',
    status: 'running',
    phases: 1,
    currentPhase: 1,
    phaseActive: true,
    manifest: [{ name: 'Count tokens', tasks: ['Read the transcript'], kind: 'phase' }],
    startedAt: 1,
    lastEventAt: 2,
  };
  const groups: JobGroup[] = [{
    chain,
    run: null,
    sessions: { 1: 'job-session' },
    tokenCounts: { 1: 123_456 },
    startedAt: 1,
  }];

  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups,
    activeSessionId: null,
    onOpenSession: () => undefined,
  }));

  assert.match(markup, /data-slot="jobs-sidebar-row-token-total" data-token-count="123456"/);
  assert.match(markup, /data-slot="jobs-sidebar-token-total" data-token-count="123456"/);
  assert.equal((markup.match(/123,456/g) ?? []).length, 2);
});
