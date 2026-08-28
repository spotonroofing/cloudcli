import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ActivityCounterButton from './ActivityCounterButton';
import ResponseSignal from './ResponseSignal';

test('the footer renders one wide planner button when only planners are active', () => {
  const markup = renderToStaticMarkup(createElement(ActivityCounterButton, {
    plannerCount: 2,
    workerCount: 0,
    plannerLabel: 'Planner',
    workerLabel: 'Worker',
    responseKinds: { planner: true, worker: false },
    onOpen: () => undefined,
  }));

  assert.match(markup, /data-slot="activity-counter-button"/);
  assert.match(markup, /data-kinds="planner"/);
  assert.doesNotMatch(markup, />Worker</);
  assert.match(markup, /data-slot="response-indicator-planner"/);
});

test('the same footer button carries split planner and worker anatomy', () => {
  const markup = renderToStaticMarkup(createElement(ActivityCounterButton, {
    plannerCount: 1,
    workerCount: 3,
    plannerLabel: 'Planner',
    workerLabel: 'Worker',
    responseKinds: { planner: true, worker: true },
    onOpen: () => undefined,
  }));

  assert.equal((markup.match(/data-slot="activity-counter-button"/g) ?? []).length, 1);
  assert.match(markup, /data-kinds="planner worker"/);
  assert.match(markup, />Planner</);
  assert.match(markup, />Worker</);
});

test('planner and worker response strokes remain visibly distinct', () => {
  const markup = renderToStaticMarkup(createElement(ResponseSignal, {
    kinds: { planner: true, worker: true },
  }));

  assert.match(markup, /data-slot="response-indicator-planner"/);
  assert.match(markup, /data-slot="response-indicator-worker"/);
});
