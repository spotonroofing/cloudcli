export type TranscriptFillAction = 'fetch' | 'reveal' | 'wait' | 'idle';

/**
 * Decides whether the transcript's loaded window must grow to fill the
 * viewport (ui12 job 11). Opening or refreshing a session fetches one tail
 * page; when that page is shorter than the pane, the pane used to sit
 * half-empty behind a "scroll up to load more" banner. This keeps fetching
 * older pages until the container is scrollable or the transcript is
 * exhausted; each fill fetch re-pins the newest message to the bottom.
 *
 * The trigger is scroll slack, not strict unscrollability (ui17 job 19). An
 * automatic tail refresh re-applies the 20-row request boundary to the cached
 * transcript (ui17 job 2, `boundPersistedWindow`), and when those rows are a
 * run of tool calls that collapse into one group, the pane drops to a couple
 * of pixels of scroll range mid-stream: technically scrollable, functionally a
 * dead wheel. Half a viewport of range is the floor.
 *
 * ui17 job 19: fetching was not the only way a pane can come up short. Rows
 * already loaded but held back by the client window (`visibleMessageCount`)
 * are revealed by scrolling to the top — which an unscrollable pane can never
 * produce, because no scroll event can fire. A run of tool rows collapsed into
 * one group shrinks a full window of messages to a few hundred pixels, so the
 * transcript sat at the top of the pane with dead space below it and a wheel
 * that did nothing until a page refresh. Revealing loaded rows is free, so it
 * comes before a fetch; both keep going until the pane is scrollable again.
 */
/** A pane with less than this share of a viewport in scroll range reads as stuck. */
export const MIN_SCROLL_SLACK_RATIO = 0.5;

export function resolveTranscriptFillAction(args: {
  /** True while the server reports older pages beyond the loaded window. */
  hasMore: boolean;
  /** True while loaded messages sit outside the client-side visible window. */
  hasHiddenLoaded: boolean;
  /** True while the initial history fetch is in flight. */
  isLoadingInitial: boolean;
  /** True while an older-page fetch is already in flight. */
  isFetchingPage: boolean;
  scrollHeight: number;
  clientHeight: number;
}): TranscriptFillAction {
  if (args.isLoadingInitial || args.isFetchingPage) return 'wait';
  const slack = args.scrollHeight - args.clientHeight;
  if (slack > args.clientHeight * MIN_SCROLL_SLACK_RATIO) return 'idle';
  if (args.hasHiddenLoaded) return 'reveal';
  return args.hasMore ? 'fetch' : 'idle';
}
