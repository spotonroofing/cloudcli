import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import ComposerClearCounter, { CLEAR_ARM_WINDOW_MS, clearTapOutcome } from './ComposerClearCounter';

test('the first tap arms and only the second one clears', () => {
  assert.equal(clearTapOutcome('idle', true), 'arm');
  assert.equal(clearTapOutcome('armed', true), 'clear');
});

test('an empty composer ignores taps in either state', () => {
  assert.equal(clearTapOutcome('idle', false), 'ignore');
  assert.equal(clearTapOutcome('armed', false), 'ignore');
});

test('the arm window is the two seconds Willem asked for', () => {
  assert.equal(CLEAR_ARM_WINDOW_MS, 2000);
});

test('at rest the counter shows the count and hides the clear X', () => {
  const html = renderToStaticMarkup(
    <ComposerClearCounter
      length={1234}
      canClear
      clearUndoPending={false}
      onClearComposer={() => {}}
      onUndoClear={() => {}}
    />,
  );
  assert.match(html, /data-slot="char-counter"/);
  assert.match(html, /1,234/);
  assert.match(html, /opacity-0[^>]*data-slot="composer-clear"/);
  assert.doesNotMatch(html, /data-armed/);
});

test('the undo affordance replaces the counter while a clear can be undone', () => {
  const html = renderToStaticMarkup(
    <ComposerClearCounter
      length={0}
      canClear={false}
      clearUndoPending
      onClearComposer={() => {}}
      onUndoClear={() => {}}
    />,
  );
  assert.match(html, /data-slot="composer-undo-clear"/);
  assert.match(html, /undo-deplete/);
  assert.doesNotMatch(html, /data-slot="char-counter"/);
});
