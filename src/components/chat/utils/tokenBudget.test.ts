import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeTokenBudget } from './tokenBudget';

describe('mergeTokenBudget', () => {
  const sdkBudget = {
    used: 40_000,
    total: 155_000,
    rawTotal: 200_000,
    totalIsUsableWindow: true,
    categories: { systemPrompt: 3_000 },
    contextUsageSource: 'sdk',
  };

  it('takes the incoming budget when nothing came before', () => {
    const incoming = { used: 10, total: 160_000 };
    assert.deepEqual(mergeTokenBudget(null, incoming), incoming);
  });

  it('replaces a file snapshot with a fresher file snapshot', () => {
    const incoming = { used: 50_000, total: 160_000 };
    assert.deepEqual(mergeTokenBudget({ used: 40_000, total: 160_000 }, incoming), incoming);
  });

  // File snapshots and mid-stream budgets carry fresh counters but only the
  // env-guess denominator; the SDK-derived window and breakdown must survive.
  it('keeps the SDK window and categories under a snapshot with fresh counters', () => {
    const merged = mergeTokenBudget(sdkBudget, { used: 52_000, total: 160_000 });
    assert.equal(merged.used, 52_000);
    assert.equal(merged.total, 155_000);
    assert.equal(merged.rawTotal, 200_000);
    assert.equal(merged.totalIsUsableWindow, true);
    assert.deepEqual(merged.categories, { systemPrompt: 3_000 });
    assert.equal(merged.contextUsageSource, 'sdk');
  });

  it('lets a newer SDK budget replace the previous one wholesale', () => {
    const incoming = { ...sdkBudget, used: 60_000, total: 150_000 };
    assert.deepEqual(mergeTokenBudget(sdkBudget, incoming), incoming);
  });
});
