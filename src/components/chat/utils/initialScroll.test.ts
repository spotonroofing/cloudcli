import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveInitialScrollAction } from './initialScroll';

describe('resolveInitialScrollAction', () => {
  const base = {
    pending: true,
    isLoading: false,
    hasMessages: true,
    hydrated: true,
    searchActive: false,
  };

  it('scrolls when armed with loaded content', () => {
    assert.equal(resolveInitialScrollAction(base), 'scroll');
  });

  it('does nothing once the pass has been consumed', () => {
    assert.equal(resolveInitialScrollAction({ ...base, pending: false }), 'wait');
  });

  it('stands down for search navigation', () => {
    assert.equal(resolveInitialScrollAction({ ...base, searchActive: true }), 'disarm');
  });

  it('waits while the history fetch is in flight', () => {
    assert.equal(
      resolveInitialScrollAction({ ...base, isLoading: true, hasMessages: false, hydrated: false }),
      'wait',
    );
  });

  // The phase 11 regression: on a session switch the effect runs before the
  // loading flag flips, with an empty transcript and an unhydrated slot. The
  // armed pass must survive that render so the robust scroll still runs when
  // the fetched messages land.
  it('keeps the pass armed on an empty transcript that has not been fetched', () => {
    assert.equal(
      resolveInitialScrollAction({ ...base, hasMessages: false, hydrated: false }),
      'wait',
    );
  });

  it('disarms on a genuinely empty session after its fetch completed', () => {
    assert.equal(
      resolveInitialScrollAction({ ...base, hasMessages: false, hydrated: true }),
      'disarm',
    );
  });
});
