import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActivityCounterButton from './ActivityCounterButton';
import ActiveSessionsDrawer from './ActiveSessionsDrawer';
import ResponseSignal from './ResponseSignal';

test('the footer renders one vertically centered monochrome planner line', () => {
  const markup = renderToStaticMarkup(createElement(ActivityCounterButton, {
    plannerCount: 2,
    workerCount: 0,
    plannerLabel: 'Planner',
    workerLabel: 'Worker',
    onOpen: () => undefined,
  }));

  assert.match(markup, /data-slot="activity-counter-button"/);
  assert.match(markup, /data-kinds="planner"/);
  assert.match(markup, /data-layout="single"/);
  assert.match(markup, /data-kind="planner"/);
  assert.doesNotMatch(markup, /data-kind="worker"/);
  assert.doesNotMatch(markup, /emerald|green|primary/);
});

test('the taskbar activity button stacks worker above planner', () => {
  const markup = renderToStaticMarkup(createElement(ActivityCounterButton, {
    plannerCount: 1,
    workerCount: 3,
    plannerLabel: 'Planner',
    workerLabel: 'Worker',
    onOpen: () => undefined,
  }));

  assert.equal((markup.match(/data-slot="activity-counter-button"/g) ?? []).length, 1);
  assert.match(markup, /data-kinds="planner worker"/);
  assert.match(markup, /data-layout="stacked"/);
  assert.ok(markup.indexOf('data-kind="worker"') < markup.indexOf('data-kind="planner"'));
  assert.doesNotMatch(markup, /emerald|green|primary/);
});

test('the activity button renders nothing when the footer is idle', () => {
  const markup = renderToStaticMarkup(createElement(ActivityCounterButton, {
    plannerCount: 0,
    workerCount: 0,
    plannerLabel: 'Planner',
    workerLabel: 'Worker',
    onOpen: () => undefined,
  }));

  assert.equal(markup, '');
});

test('the active sessions drawer uses monochrome borderless sidebar rows', () => {
  const t = ((key: string, fallback?: string) => fallback ?? key) as never;
  const markup = renderToStaticMarkup(createElement(ActiveSessionsDrawer, {
    kinds: ['planner', 'worker'],
    open: true,
    onClose: () => undefined,
    rows: [
      { sessionId: 'planner-1', kind: 'planner', label: 'Planner 1', projectId: 'p', projectDisplayName: 'CloudCLI', state: 'working', provider: 'codex' },
      { sessionId: 'worker-1', kind: 'worker', label: 'Worker 1', projectId: 'p', projectDisplayName: 'CloudCLI', state: 'working', provider: 'codex' },
    ],
    onSelect: () => undefined,
    isMobile: false,
    t,
  }));

  assert.match(markup, /data-slot="active-sessions-drawer"/);
  assert.equal((markup.match(/data-slot="active-session-row"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /emerald|green|amber/);
  assert.doesNotMatch(markup, /Worker 1\s*(?:--|—)/);
});

test('planner and worker response strokes remain visibly distinct', () => {
  const markup = renderToStaticMarkup(createElement(ResponseSignal, {
    kinds: { planner: true, worker: true },
  }));

  assert.match(markup, /data-slot="response-indicator-planner"/);
  assert.match(markup, /data-slot="response-indicator-worker"/);
});
