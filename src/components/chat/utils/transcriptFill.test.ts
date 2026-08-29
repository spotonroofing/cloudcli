import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveTranscriptFillAction } from './transcriptFill';

describe('resolveTranscriptFillAction', () => {
  const base = {
    hasMore: true,
    hasHiddenLoaded: false,
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

  // ui17 job 19: one scrollable pixel is not enough. A tail refresh that
  // re-applies the 20-row boundary can leave a pane a couple of pixels of
  // range, which reads as a dead wheel; the fill keeps going to half a
  // viewport of slack.
  it('keeps filling while the pane has only a sliver of scroll range', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, scrollHeight: 601 }),
      'fetch',
    );
  });

  it('idles once the pane has half a viewport of scroll range', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, scrollHeight: 901 }),
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

  // The job 19 regression (Willem's screenshot, 2026-08-29 12:20 am): a run of
  // Bash rows collapsed into one group left the loaded window shorter than the
  // pane. Nothing could grow it, because revealing more loaded rows was wired
  // to a scroll-to-top event an unscrollable pane can never fire.
  it('reveals loaded rows before fetching when the pane is short', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, hasHiddenLoaded: true }),
      'reveal',
    );
  });

  it('reveals even with nothing left to fetch, which used to deadlock', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, hasMore: false, hasHiddenLoaded: true }),
      'reveal',
    );
  });

  it('stops revealing once the pane has real scroll range', () => {
    assert.equal(
      resolveTranscriptFillAction({ ...base, hasHiddenLoaded: true, scrollHeight: 901 }),
      'idle',
    );
  });

  it('converges: reveals loaded rows, then fetches, then idles', () => {
    const clientHeight = 600;
    let scrollHeight = 240;
    let hidden = 40;
    let pagesLeft = 1;
    const actions: string[] = [];

    for (let step = 0; step < 10; step += 1) {
      const action = resolveTranscriptFillAction({
        hasMore: pagesLeft > 0,
        hasHiddenLoaded: hidden > 0,
        isLoadingInitial: false,
        isFetchingPage: false,
        scrollHeight,
        clientHeight,
      });
      actions.push(action);
      if (action === 'reveal') {
        hidden = Math.max(0, hidden - 30);
        scrollHeight += 120;
        continue;
      }
      if (action === 'fetch') {
        pagesLeft -= 1;
        scrollHeight += 250;
        continue;
      }
      break;
    }

    assert.deepEqual(actions, ['reveal', 'reveal', 'fetch', 'idle']);
    // It idles only once there is nothing left to reveal or fetch, never while
    // rows are still available and the pane is short.
    assert.equal(hidden, 0);
    assert.equal(pagesLeft, 0);
    assert.ok(scrollHeight > clientHeight);
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
        hasHiddenLoaded: false,
        isLoadingInitial: false,
        isFetchingPage: false,
        scrollHeight,
        clientHeight,
      });
      actions.push(action);
      if (action !== 'fetch') break;
      pagesLeft -= 1;
      scrollHeight += pageHeight;
      // The hook pins after every fill fetch (preserveScroll: false).
      scrollTop = Math.max(scrollHeight - clientHeight, 0);
    }

    assert.deepEqual(actions, ['fetch', 'fetch', 'fetch', 'idle']);
    // Ends scrollable and pinned to the bottom.
    assert.ok(scrollHeight > clientHeight);
    assert.equal(scrollTop, scrollHeight - clientHeight);
  });
});
