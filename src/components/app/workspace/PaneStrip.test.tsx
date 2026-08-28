import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import PaneStrip, { type StripPane } from './PaneStrip';

const pane = (
  id: StripPane['id'],
  minWidth: number,
  basis?: string,
): StripPane => ({
  id,
  state: 'open',
  railLabel: id,
  weight: 1,
  minWidth,
  basis,
  onExpand: () => undefined,
  content: <div>{id}</div>,
});

test('the jobs-bearing worker pane carries responsive space beside equal grow weights', () => {
  const markup = renderToStaticMarkup(
    <PaneStrip
      panes={[
        pane('planner', 160),
        pane('worker', 160, 'min(15rem, 33.333cqw)'),
      ]}
      onPairWeights={() => undefined}
    />,
  );

  assert.match(markup, /container-type:inline-size/);
  assert.match(markup, /flex:1 1 0px;min-width:160px/);
  assert.match(markup, /flex:1 1 min\(15rem, 33\.333cqw\);min-width:160px/);
  assert.equal((markup.match(/data-slot="pane-divider"/g) ?? []).length, 1);
});

test('three open panes render two dividers in deterministic order', () => {
  const markup = renderToStaticMarkup(
    <PaneStrip
      panes={[pane('planner', 160), pane('worker', 160), pane('files', 160)]}
      onPairWeights={() => undefined}
    />,
  );

  assert.ok(markup.indexOf('data-strip-pane="planner"') < markup.indexOf('data-strip-pane="worker"'));
  assert.ok(markup.indexOf('data-strip-pane="worker"') < markup.indexOf('data-strip-pane="files"'));
  assert.equal((markup.match(/data-slot="pane-divider"/g) ?? []).length, 2);
});
