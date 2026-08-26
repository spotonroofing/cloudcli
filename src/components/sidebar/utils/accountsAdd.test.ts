import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addCompleted, captureAddBaseline } from './accountsAdd';

const a = { number: 1, email: 'a@x.com', active: true };
const b = { number: 2, email: 'b@x.com', active: false };

describe('addCompleted', () => {
  it('stays false while the list matches the baseline', () => {
    const baseline = captureAddBaseline([a, b]);
    assert.equal(addCompleted(baseline, [a, b]), false);
  });

  it('is true once a new slot appears', () => {
    const baseline = captureAddBaseline([a, b]);
    assert.equal(addCompleted(baseline, [a, b, { number: 3, email: 'c@x.com', active: true }]), true);
  });

  it('is true when cswap add re-captured an existing slot and made it active', () => {
    const baseline = captureAddBaseline([a, b]);
    assert.equal(
      addCompleted(baseline, [
        { ...a, active: false },
        { ...b, active: true },
      ]),
      true,
    );
  });

  it('treats a usage-only refresh of the same accounts as no completion', () => {
    const baseline = captureAddBaseline([a, b]);
    assert.equal(addCompleted(baseline, [{ ...a }, { ...b }]), false);
  });
});
