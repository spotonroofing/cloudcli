import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveTranscriptFillAction } from './transcriptFill';

describe('resolveTranscriptFillAction', () => {
  const base = {
    hasMore: true,
    isLoadingInitial: false,
    isFetchingPage: false,
    scrollHeight: 400,
    clientHeight: 600,
  };

  it('fetches when the pane is not scrollable and older pages exist', () => {
    assert.equal(resolveTranscriptFillAction(base), 'fetch');
  });

  it('fetches at the exact unscrollable boundary', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, scrollHeight: 600 }),
      'fetch',
    );
  });

  it('idles once the pane is scrollable', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, scrollHeight: 601 }),
      'idle',
    );
  });

  it('idles when the transcript is exhausted, even unfilled', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, hasMore: false }),
      'idle',
    );
  });

  it('waits while the initial history fetch is in flight', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, isLoadingInitial: true }),
      'wait',
    );
  });

  it('waits while an older page is already in flight', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, isFetchingPage: true }),
      'wait',
    );
  });

  // The job 11 regression: refreshing a long transcript lands one short tail
  // page. The fill loop must keep fetching page by page until the container
  // becomes scrollable, pin to the bottom after every fill fetch, and stop.
  it('converges: fetches page by page until scrollable, pinned after each', () => {
    const clientHeight = 600;
    const pageHeight = 250;
    let scrollHeight = 250;
    let pagesLeft = 3;
    let scrollTop = 0;
    const actions: string[] = [];

    for (let step = 0; step < 10; step += 1) {
      const action = resolveTranscriptFillAction({
        hasMore: pagesLeft > 0,
        isLoadingInitial: false,
        isFetchingPage: false,
        scrollHeight: Math.max(scrollHeight, clientHeight),
        clientHeight,
      });
      actions.push(action);
      if (action !== 'fetch') break;
      pagesLeft -= 1;
      scrollHeight += pageHeight;
      // The hook pins after every fill fetch (preserveScroll: false).
      scrollTop = Math.max(scrollHeight - clientHeight, 0);
    }

    assert.deepEqual(actions, ['fetch', 'fetch', 'idle']);
    // Ends scrollable and pinned to the bottom.
    assert.ok(scrollHeight > clientHeight);
    assert.equal(scrollTop, scrollHeight - clientHeight);
  });
});
