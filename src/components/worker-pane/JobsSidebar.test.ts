import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import JobsSidebar, {
  JOBS_COLUMN_BASIS,
  JOBS_HISTORY_PAGE_SIZE,
  type ChainSnapshot,
  type JobGroup,
} from './JobsSidebar';

const renderJobs = (groups: JobGroup[]) => renderToStaticMarkup(createElement(JobsSidebar, {
  groups,
  activeSessionId: null,
  onOpenSession: () => undefined,
}));

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

test('a task-kind unit renders with the same row anatomy as a phase unit (ui17 job 11)', () => {
  const chain: ChainSnapshot = {
    slug: 'uniform-stub',
    projectPath: '/workspace/uniform-stub',
    status: 'running',
    phases: 2,
    currentPhase: 1,
    phaseActive: true,
    manifest: [
      { name: 'Compiled job', tasks: ['One', 'Two'], kind: 'phase', done: 2 },
      { name: 'Appended job', tasks: ['One', 'Two'], kind: 'task', done: 2 },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };
  const markup = renderJobs([{ chain, run: null, sessions: {}, startedAt: 1 }]);

  const rows = [...markup.matchAll(/<div[^>]*data-slot="jobs-sidebar-row"[^>]*>/g)].map((m) => m[0]);
  assert.equal(rows.length, 2);
  const rowClass = (row: string) => /class="([^"]*)"/.exec(row)?.[1] ?? '';
  // The kind still rides on the row for data, but nothing about the look
  // reads it: same height, no indent, no scaled icon, one title size.
  const phaseRow = rows.find((row) => row.includes('data-kind="phase"'));
  const taskRow = rows.find((row) => row.includes('data-kind="task"'));
  assert.ok(phaseRow && taskRow);
  assert.equal(rowClass(phaseRow), rowClass(taskRow));
  assert.doesNotMatch(markup, /min-h-7/);
  assert.doesNotMatch(markup, /scale-90/);
  assert.equal((markup.match(/text-\[12px\]/g) ?? []).length, 0);
  assert.equal((markup.match(/data-slot="job-ring-segment"/g) ?? []).length, 4);
});

test('the running chain header exposes the bolt toggle and fast units keep their bolt', () => {
  const chain: ChainSnapshot = {
    slug: 'fast-stub',
    projectPath: '/workspace/fast-stub',
    status: 'running',
    phases: 2,
    currentPhase: 2,
    phaseActive: true,
    fastMode: true,
    manifest: [
      { name: 'Fast build', tasks: [], kind: 'phase', fastMode: true, commitHash: 'abc1234' },
      { name: 'Current build', tasks: [], kind: 'phase' },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };

  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups: [{ chain, run: null, sessions: {}, startedAt: 1 }],
    activeSessionId: null,
    onOpenSession: () => undefined,
    onToggleFastMode: () => undefined,
    fastModeHintSlug: chain.slug,
  }));

  assert.match(markup, /data-slot="jobs-chain-header" data-chain="fast-stub"/);
  assert.match(markup, /data-slot="chain-fast-mode-hint"[^>]*>next job runs fast</);
  assert.match(markup, /data-slot="chain-fast-mode-toggle" data-chain="fast-stub" data-fast-mode="on"/);
  assert.match(markup, /data-slot="jobs-sidebar-fast-unit"/);
});

test('a verify-failed unit stays red while the running chain header counts the failure', () => {
  const chain: ChainSnapshot = {
    slug: 'verify-continues-stub',
    projectPath: '/workspace/verify-continues-stub',
    status: 'running',
    phases: 3,
    currentPhase: 3,
    phaseActive: true,
    verifyFailures: 1,
    manifest: [
      { name: 'One', tasks: [], kind: 'phase', commitHash: 'abc1111', verify: 'passed' },
      {
        name: 'Two',
        tasks: ['Ship', 'Meet the budget'],
        kind: 'phase',
        done: 1,
        commitHash: 'abc2222',
        verify: 'failed',
        failureReason: 'Second unit missed its budget.',
      },
      { name: 'Three', tasks: [], kind: 'phase' },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };

  const markup = renderToStaticMarkup(createElement(JobsSidebar, {
    groups: [{ chain, run: null, sessions: {}, startedAt: 1 }],
    activeSessionId: null,
    onOpenSession: () => undefined,
    onToggleFastMode: () => undefined,
  }));

  assert.match(markup, /data-slot="jobs-chain-header" data-chain="verify-continues-stub" data-verify-failures="1"/);
  assert.match(markup, /data-slot="jobs-chain-verify-failures"[^>]*>1 verify failure</);
  assert.match(markup, /data-job="2" data-chain="verify-continues-stub" data-kind="phase" data-status="cancelled"/);
  assert.equal((markup.match(/data-slot="job-ring-segment"[^>]*data-failed="true"/g) ?? []).length, 2);
  assert.match(markup, /data-terminal-mark="x"/);
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

test('collapsed rows omit token and task counters while the drawer keeps the token total', () => {
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

  assert.doesNotMatch(markup, /data-slot="jobs-sidebar-row-token-total"/);
  assert.doesNotMatch(markup, /data-slot="jobs-sidebar-row-count"/);
  assert.match(markup, /data-slot="jobs-sidebar-token-total" data-token-count="123456"/);
  assert.equal((markup.match(/123,456/g) ?? []).length, 1);
});

test('completed task durations are hover-only and long labels use the once-through marquee', () => {
  const startedAt = Date.now() - 180_000;
  const chain: ChainSnapshot = {
    slug: 'timing-stub',
    projectPath: '/workspace/timing-stub',
    status: 'running',
    phases: 1,
    currentPhase: 1,
    phaseActive: true,
    manifest: [{
      name: 'Time each task',
      tasks: ['Completed work', 'Live work'],
      kind: 'phase',
      done: 1,
      startedAt,
      taskTimes: [startedAt + 110_000],
    }],
    startedAt,
    lastEventAt: Date.now(),
  };

  const markup = renderJobs([{ chain, run: null, sessions: {}, startedAt }]);
  assert.match(markup, /data-marquee-mode="once"[^>]*line-through/);
  assert.match(markup, /data-slot="jobs-sidebar-task-duration" class="[^"]*font-mono[^"]*opacity-0[^>]*>1m 50s</);
  assert.doesNotMatch(markup, /data-slot="jobs-sidebar-task-duration" data-live="true"/);
  assert.match(markup, /<ul class="pb-0\.5 pl-5">/);
  assert.equal(JOBS_COLUMN_BASIS, 'min(16.25rem, calc(33.333cqw + 1.25rem))');
});

test('the commit tooltip trigger stays constrained inside the footer', () => {
  const chain: ChainSnapshot = {
    slug: 'tooltip-stub',
    projectPath: '/workspace/tooltip-stub',
    status: 'completed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{
      name: 'Tooltip',
      tasks: [],
      kind: 'phase',
      commitHash: 'abc1234',
      commitSubject: 'A deliberately long complete commit subject',
    }],
    startedAt: Date.now(),
    lastEventAt: Date.now(),
  };

  const markup = renderJobs([{ chain, run: null, sessions: {}, startedAt: chain.startedAt }]);
  assert.match(markup, /overflow-hidden \[&amp;&gt;\.relative\]:max-w-full/);
  assert.match(markup, /A deliberately long complete commit subject/);
});

test('completed and failed jobs keep segmented rings with centered terminal marks', () => {
  const completed: ChainSnapshot = {
    slug: 'completed-stub',
    projectPath: '/workspace/history-stub',
    status: 'completed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{ name: 'Finished job', tasks: ['One', 'Two'], kind: 'phase', done: 2 }],
    startedAt: Date.now(),
    lastEventAt: Date.now(),
  };
  const failed: ChainSnapshot = {
    slug: 'failed-stub',
    projectPath: '/workspace/history-stub',
    status: 'failed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{
      name: 'Failed job',
      tasks: ['Landed', 'Broke', 'Unreached'],
      kind: 'phase',
      done: 1,
      failureReason: 'Build command exited 1.',
    }],
    startedAt: Date.now() - 1_000,
    lastEventAt: Date.now(),
  };

  const completedMarkup = renderJobs([{ chain: completed, run: null, sessions: {}, startedAt: completed.startedAt }]);
  assert.equal((completedMarkup.match(/data-slot="job-ring-segment" data-done="true"/g) ?? []).length, 2);
  assert.match(completedMarkup, /data-terminal-mark="check"/);
  assert.match(completedMarkup, /M9 12\.2 11 14\.2 15\.2 9\.8/);

  const failedMarkup = renderJobs([{ chain: failed, run: null, sessions: {}, startedAt: failed.startedAt }]);
  assert.equal((failedMarkup.match(/data-slot="job-ring-segment" data-done="true"/g) ?? []).length, 1);
  assert.equal((failedMarkup.match(/data-failed="true"/g) ?? []).length, 3);
  assert.match(failedMarkup, /data-status="cancelled"/);
  assert.match(failedMarkup, /data-terminal-mark="x"/);
  assert.match(failedMarkup, /text-rose-600/);
  assert.match(failedMarkup, /data-slot="jobs-sidebar-failure-reason"[^>]*>Build command exited 1\.<\/li>/);
  assert.match(failedMarkup, /M9 9 15\.2 15\.2M15\.2 9 9 15\.2/);
});

test('a committed verify failure repaired by its superseding unit reads done once', () => {
  const failed: ChainSnapshot = {
    slug: 'original',
    projectPath: '/workspace/repair-stub',
    status: 'failed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{
      name: 'Context diet',
      tasks: ['Land the build'],
      kind: 'phase',
      done: 1,
      commitHash: 'abc1234',
      verify: 'failed',
      failureReason: 'Verifier found a regression.',
      hidden: true,
      supersededBy: 'repair/1',
    }],
    startedAt: 1,
    lastEventAt: 2,
  };
  const repair: ChainSnapshot = {
    slug: 'repair',
    projectPath: '/workspace/repair-stub',
    status: 'completed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{ name: 'Context diet repair', tasks: [], kind: 'phase', commitHash: 'def5678', verify: 'passed' }],
    startedAt: 3,
    lastEventAt: 4,
  };

  const markup = renderJobs([
    { chain: failed, run: null, sessions: { 1: 'original-session' }, startedAt: failed.startedAt },
    { chain: repair, run: null, sessions: { 1: 'repair-session' }, startedAt: repair.startedAt },
  ]);
  assert.equal((markup.match(/data-slot="jobs-sidebar-row"/g) ?? []).length, 1);
  assert.match(markup, /data-chain="original"[^>]*data-status="completed"/);
  assert.equal((markup.match(/data-slot="job-ring-segment"[^>]*data-failed="true"/g) ?? []).length, 0);
  assert.match(markup, /data-terminal-mark="check"/);
  assert.match(markup, /data-slot="jobs-sidebar-verify-fixed"[^>]*>Verify fixed in Context diet repair<\/li>/);
  assert.doesNotMatch(markup, />Verify failed</);
  assert.doesNotMatch(markup, /data-slot="jobs-sidebar-failure-reason"/);
});

test('a committed current unit is done when its chain ended before verify', () => {
  const chain: ChainSnapshot = {
    slug: 'ended-before-verify',
    projectPath: '/workspace/ended-before-verify',
    status: 'failed',
    phases: 4,
    currentPhase: 4,
    phaseActive: false,
    manifest: [
      { name: 'One', tasks: [], kind: 'phase', commitHash: '1111111', verify: 'passed' },
      { name: 'Two', tasks: [], kind: 'phase', commitHash: '2222222', verify: 'passed' },
      { name: 'Three', tasks: [], kind: 'phase', commitHash: '3333333', verify: 'failed' },
      { name: 'Footer icons', tasks: ['Land it'], kind: 'phase', commitHash: 'ac73a56', done: 1 },
    ],
    startedAt: 1,
    lastEventAt: 2,
  };
  const markup = renderJobs([{ chain, run: null, sessions: {}, startedAt: 1 }]);

  assert.match(markup, /data-job="4"[^>]*data-status="completed"/);
  assert.match(markup, /data-slot="jobs-sidebar-verify-never-ran"[^>]*>Verify never ran, chain ended<\/li>/);
  assert.doesNotMatch(markup, /Job stopped before completion/);
});

test('verify renders live and then settles above engine, commit, and total metadata', () => {
  const chain = (verify: 'running' | 'passed'): ChainSnapshot => ({
    slug: `verify-${verify}`,
    projectPath: '/workspace/verify-stub',
    status: verify === 'running' ? 'running' : 'completed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{
      name: 'Jobs view polish',
      tasks: ['Finish the build'],
      kind: 'phase',
      done: 1,
      commitHash: 'abc1234',
      commitSubject: 'feat(jobs): complete the drawer',
      startedAt: Date.now() - 20_000,
      endedAt: Date.now() - 10_000,
      taskTimes: [Date.now() - 12_000],
      verify,
      verifyStartedAt: Date.now() - 10_000,
      verifyEndedAt: verify === 'passed' ? Date.now() : undefined,
      engine: 'codex',
      model: 'gpt-5.6-sol',
    }],
    startedAt: Date.now() - 20_000,
    lastEventAt: Date.now(),
  });

  const running = chain('running');
  const runningMarkup = renderJobs([{ chain: running, run: null, sessions: {}, startedAt: running.startedAt }]);
  assert.match(runningMarkup, /data-slot="jobs-sidebar-verify" data-status="in-progress" data-live="true"/);
  assert.match(runningMarkup, /Verifying Jobs view polish/);

  const passed = chain('passed');
  const passedMarkup = renderJobs([{ chain: passed, run: null, sessions: {}, startedAt: passed.startedAt }]);
  assert.match(passedMarkup, /data-slot="jobs-sidebar-verify" data-status="completed"/);
  assert.match(passedMarkup, />Verified</);
  const order = [
    'data-slot="jobs-sidebar-task"',
    'data-slot="jobs-sidebar-verify"',
    'data-slot="jobs-sidebar-job-engine"',
    'data-slot="jobs-sidebar-job-commit"',
    'data-slot="jobs-sidebar-job-total"',
  ].map((needle) => passedMarkup.indexOf(needle));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('older months and years render clean grouping rows with completed-job counts', () => {
  const makeChain = (slug: string, startedAt: number): ChainSnapshot => ({
    slug,
    projectPath: '/workspace/grouping-stub',
    status: 'completed',
    phases: 1,
    currentPhase: 1,
    phaseActive: false,
    manifest: [{ name: slug, tasks: [], kind: 'phase', startedAt }],
    startedAt,
    lastEventAt: startedAt,
  });
  const august = Date.parse('2026-08-15T16:00:00.000Z');
  const july = Date.parse('2026-07-15T16:00:00.000Z');
  const december = Date.parse('2025-12-15T17:00:00.000Z');
  const groups = [august, july, december].map((startedAt, index) => ({
    chain: makeChain(`history-${index}`, startedAt),
    run: null,
    sessions: {},
    startedAt,
  }));

  const markup = renderJobs(groups);
  assert.match(markup, /data-slot="jobs-sidebar-month-group" data-period="2026-July"[^>]*>[\s\S]*?July[\s\S]*?1 done/);
  assert.match(markup, /data-slot="jobs-sidebar-year-group" data-period="2025"[^>]*>[\s\S]*?2025[\s\S]*?1 done/);
  assert.match(markup, /data-slot="jobs-sidebar-month-group" data-period="2025-December"/);
  assert.ok(markup.indexOf('history-0') < markup.indexOf('history-1'));
  assert.ok(markup.indexOf('history-1') < markup.indexOf('history-2'));
});

test('long jobs history mounts one replace-in-place page', () => {
  const groups: JobGroup[] = Array.from({ length: JOBS_HISTORY_PAGE_SIZE + 25 }, (_, index) => ({
    chain: null,
    run: { label: `Run ${index}`, state: 'finished' },
    sessions: { 1: `session-${index}` },
    startedAt: Date.now() - index,
  }));

  const markup = renderJobs(groups);
  assert.equal(
    (markup.match(/data-slot="jobs-sidebar-row"/g) ?? []).length,
    JOBS_HISTORY_PAGE_SIZE,
  );
  assert.match(markup, new RegExp(`data-history-total="${JOBS_HISTORY_PAGE_SIZE + 25}"`));
  assert.match(markup, /data-slot="jobs-history-pages"/);
  assert.match(markup, /data-slot="jobs-history-newer" disabled=""/);
  assert.match(markup, /data-slot="jobs-history-older"/);
  assert.match(markup, />1 \/ 2</);
});
