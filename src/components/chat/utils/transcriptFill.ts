export type TranscriptFillAction = 'fetch' | 'wait' | 'idle';

/**
 * Decides whether the transcript's loaded window must grow to fill the
 * viewport (ui12 job 11). Opening or refreshing a session fetches one tail
 * page; when that page is shorter than the pane, the pane used to sit
 * half-empty behind a "scroll up to load more" banner. This keeps fetching
 * older pages until the container is scrollable or the transcript is
 * exhausted; each fill fetch re-pins the newest message to the bottom.
 *
 * A container is unscrollable exactly when scrollHeight does not exceed
 * clientHeight, so that comparison is the fill trigger.
 */
export function resolveTranscriptFillAction(args: {
  /** True while the server reports older pages beyond the loaded window. */
  hasMore: boolean;
  /** True while the initial history fetch is in flight. */
  isLoadingInitial: boolean;
  /** True while an older-page fetch is already in flight. */
  isFetchingPage: boolean;
  scrollHeight: number;
  clientHeight: number;
}): TranscriptFillAction {
  if (args.isLoadingInitial || args.isFetchingPage) return 'wait';
  if (!args.hasMore) return 'idle';
  return args.scrollHeight <= args.clientHeight ? 'fetch' : 'idle';
}
