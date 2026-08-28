import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import ActivityIndicator from './ActivityIndicator';

const activity = {
  statusText: 'Churning...',
  canInterrupt: true,
  phaseStartedAt: Date.now(),
  startedAt: Date.now(),
};

test('live activity names the real phase and lets the tool row own tool work', () => {
  // NumberTicker intentionally uses a layout effect in the browser; suppress
  // React's expected server-render warning while inspecting this static row.
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const thinking = renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'thinking' }} />);
    assert.match(thinking, /data-phase="thinking"/);
    assert.match(thinking, />Thinking</);
    assert.doesNotMatch(thinking, /Churning|Working/);

    const writing = renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'writing' }} />);
    assert.match(writing, /data-phase="writing"/);
    assert.match(writing, />Writing</);

    assert.equal(renderToStaticMarkup(<ActivityIndicator activity={{ ...activity, phase: 'tool' }} />), '');
  } finally {
    console.error = originalError;
  }
});
