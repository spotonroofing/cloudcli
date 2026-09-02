import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import TokenUsageSummary from './TokenUsageSummary';

// ui19 job 2: Willem's phone read 0 for sessions that were far from 0. The ring
// is one component with one prop, so the phone can only ever differ from the
// desktop if the payload differs; these tests pin both halves of that.
const SNAPSHOT_USAGE = {
  used: 317_310,
  total: 1_000_000,
  inputTokens: 316_072,
  outputTokens: 1_238,
  cacheReadTokens: 312_211,
  breakdown: { input: 316_072, output: 1_238 },
};

const renderAtWidth = (width: number, usage: Record<string, unknown> | null) => {
  const previousWidth = globalThis.innerWidth;
  Object.defineProperty(globalThis, 'innerWidth', { value: width, configurable: true });
  try {
    return renderToStaticMarkup(<TokenUsageSummary usage={usage} />);
  } finally {
    Object.defineProperty(globalThis, 'innerWidth', { value: previousWidth, configurable: true });
  }
};

test('the phone renders the same context figure as the desktop layout', () => {
  const phone = renderAtWidth(390, SNAPSHOT_USAGE);
  const desktop = renderAtWidth(1280, SNAPSHOT_USAGE);

  assert.equal(phone, desktop);
  assert.match(phone, /data-context-percent="32"/);
  assert.match(phone, /317,310 tokens/);
});

test('a usage payload that carries a total is never read as zero percent', () => {
  const html = renderAtWidth(390, SNAPSHOT_USAGE);
  assert.doesNotMatch(html, /data-context-percent="0"/);
});

// Nothing arrived yet is the only state that legitimately reads 0.
test('the ring reads zero only while no usage has been received', () => {
  assert.match(renderAtWidth(390, null), /data-context-percent="0"/);
});
