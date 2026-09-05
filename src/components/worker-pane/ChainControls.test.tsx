import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChainControls from './ChainControls';
import { chainControlState } from './chainControlState';

const render = (chain: Parameters<typeof chainControlState>[0]) => renderToStaticMarkup(
  createElement(ChainControls, { chain: chain ?? null, onAction: () => undefined }),
);

test('a running chain offers pause and stop', () => {
  const state = chainControlState({ slug: 'audit1', status: 'running' });

  assert.equal(state.toggle, 'pause');
  assert.equal(state.canStop, true);
  assert.equal(state.reason, null);
});

test('a paused chain offers resume and stop', () => {
  const state = chainControlState({ slug: 'audit1', status: 'paused' });

  assert.equal(state.toggle, 'resume');
  assert.equal(state.canStop, true);
});

test('no chain and a terminal chain disable both controls with a reason', () => {
  assert.deepEqual(chainControlState(null), {
    toggle: null,
    canStop: false,
    reason: 'No chain is running for this project.',
  });
  assert.equal(chainControlState({ slug: 'audit1', status: 'stopped' }).reason, 'This chain was stopped.');
  assert.equal(chainControlState({ slug: 'audit1', status: 'completed' }).toggle, null);
});

test('the header renders the toggle in the state the chain row is in', () => {
  const running = render({ slug: 'audit1', status: 'running' });
  assert.match(running, /data-slot="chain-pause-toggle"/);
  assert.match(running, /data-action="pause"/);
  assert.match(running, /data-slot="chain-stop"/);
  assert.doesNotMatch(running, /data-slot="chain-pause-toggle"[^>]*disabled/);

  const paused = render({ slug: 'audit1', status: 'paused' });
  assert.match(paused, /data-action="resume"/);
});

test('with no chain running both controls render disabled and say why', () => {
  const markup = render(null);

  assert.match(markup, /data-chain-status="none"/);
  assert.match(markup, /No chain is running for this project\./);
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
});

test('stop is not confirmed by the button itself: no sheet until it is pressed', () => {
  assert.doesNotMatch(render({ slug: 'audit1', status: 'running' }), /data-slot="chain-stop-sheet"/);
});
