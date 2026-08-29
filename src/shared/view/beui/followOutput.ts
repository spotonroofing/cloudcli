/**
 * The follow-output state machine behind MessageScroller (ui17 job 19).
 *
 * It lives apart from the component because the bug it fixes is a race, not a
 * rendering detail: the engine's ResizeObserver repins on `following`, and the
 * reader's departure only became visible to it one scroll event later. A wheel
 * up, then a streamed row landing before the browser dispatched that scroll
 * event, left `following` true — the pane repinned, the reader's own scroll
 * event arrived while the programmatic guard was armed and was swallowed, and
 * the transcript dragged itself back to the bottom for as long as the turn
 * streamed.
 *
 * A reader gesture now sets `departed` immediately, which both blocks the
 * repin and hands the next scroll event authority over `following`. Follow
 * comes back exactly two ways: the reader scrolls to the live edge, or the
 * jump-to-latest control puts them there (its scroll lands at the edge too).
 */
export type FollowState = {
  /** True while the pane repins itself to the live edge as content grows. */
  following: boolean;
  /** True while the engine's own scroll to the end is in flight. */
  programmatic: boolean;
  /** True from a reader gesture until their scroll position settles. */
  departed: boolean;
};

export const createFollowState = (following: boolean): FollowState => ({
  following,
  programmatic: false,
  departed: false,
});

/**
 * A wheel, touch or page-key from the reader. It outranks an in-flight repin:
 * the engine's own animation is abandoned rather than allowed to swallow the
 * scroll events the gesture is about to produce.
 */
export const applyReaderGesture = (state: FollowState): FollowState => (
  state.programmatic || !state.departed
    ? { ...state, programmatic: false, departed: true }
    : state
);

/** The engine started a scroll to the end; its own events are not the reader's. */
export const applyRepinStarted = (state: FollowState): FollowState => (
  { ...state, programmatic: true }
);

/** One scroll event, with the viewport's distance from the live edge. */
export const applyScroll = (
  state: FollowState,
  distance: number,
  threshold: number,
): FollowState => {
  const atEdge = distance <= threshold;
  if (state.departed) {
    // The reader is driving. Their position decides follow, and arriving at the
    // live edge hands the pane back to the engine.
    return { following: atEdge, programmatic: false, departed: !atEdge };
  }
  if (state.programmatic) {
    // Only arrival matters: the tail of a long repin must never read as the
    // reader leaving (ui13 job 15).
    return atEdge ? { ...state, programmatic: false } : state;
  }
  return { ...state, following: atEdge };
};

/**
 * The reader's gesture stopped producing scroll events. A wheel that never
 * moved the viewport (already at the end, or nothing to scroll) would otherwise
 * strand `departed` forever, so the true distance settles it.
 */
export const applyGestureSettled = (
  state: FollowState,
  distance: number,
  threshold: number,
): FollowState => (
  state.departed
    ? { following: distance <= threshold, programmatic: false, departed: false }
    : state
);

/** Whether a content resize may repin the viewport to the live edge. */
export const shouldRepin = (state: FollowState, followOutput: boolean): boolean => (
  followOutput && state.following && !state.departed
);
