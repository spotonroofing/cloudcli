import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import ActivityIndicator from './ActivityIndicator';
import {
  ACTIVITY_PRESENTATIONS,
  pickNextPresentationIndex,
} from './activityPresentation';

const activity = {
  statusText: null,
  canInterrupt: true,
  phaseStartedAt: Date.now(),
  startedAt: Date.now(),
};

test('live activity starts with a catalog pair and lets the tool row own tool work', () => {
  // NumberTicker intentionally uses a layout effect in the browser; suppress
  // React's expected server-render warning while inspecting this static row.
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const thinking = renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'thinking' }} />);
    assert.match(thinking, /data-phase="thinking"/);
    assert.match(thinking, /data-presentation="Thinking"/);
    assert.match(thinking, /data-pattern="drive"/);
    assert.match(thinking, />Thinking</);

    const writing = renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'writing' }} />);
    assert.match(writing, /data-phase="writing"/);
    assert.match(writing, /data-presentation="Thinking"/);
    assert.match(writing, />Thinking</);

    const overridden = renderToStaticMarkup(
      <ActivityIndicator activity={{ ...activity, phase: 'thinking', statusText: 'Churning...' }} />,
    );
    assert.match(overridden, />Churning</);
    assert.match(overridden, /data-pattern="drive"/);
    assert.match(overridden, /data-server-override="true"/);

    assert.equal(renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'tool' }} />), '');
  } finally {
    console.error = originalError;
  }
});

test('activity catalog gives every word its own named pattern', () => {
  assert.ok(ACTIVITY_PRESENTATIONS.length >= 10);
  assert.equal(new Set(ACTIVITY_PRESENTATIONS.map(({ word }) => word)).size, ACTIVITY_PRESENTATIONS.length);
  assert.equal(new Set(ACTIVITY_PRESENTATIONS.map(({ variant }) => variant)).size, ACTIVITY_PRESENTATIONS.length);
});

test('rotation picker never repeats either of the previous two pairs', () => {
  const randomSamples = [0, 0.18, 0.42, 0.73, 0.999_999];

  for (const sample of randomSamples) {
    const next = pickNextPresentationIndex([3, 7], () => sample);
    assert.notEqual(next, 3);
    assert.notEqual(next, 7);
    assert.ok(next >= 0 && next < ACTIVITY_PRESENTATIONS.length);
  }
});
