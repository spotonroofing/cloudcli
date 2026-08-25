export type InitialScrollAction = 'scroll' | 'wait' | 'disarm';

/**
 * Decides what the armed initial-scroll pass does on a given render (ui11
 * phase 11). The regression this encodes: on a session switch or cold load
 * the scroll effect runs before the history fetch flips its loading flag, so
 * an empty transcript used to consume the armed flag — the robust re-anchoring
 * scroll never ran and late content reflow (markdown, code highlighting)
 * left the pane scrolled short of the newest message. An empty transcript only
 * disarms once the session's history has actually been fetched.
 */
export function resolveInitialScrollAction(args: {
  /** The armed pending-initial-scroll flag. */
  pending: boolean;
  /** True while the initial history fetch is in flight. */
  isLoading: boolean;
  hasMessages: boolean;
  /** True once the session's slot has completed a server fetch. */
  hydrated: boolean;
  /** Search navigation owns the viewport; the initial scroll stands down. */
  searchActive: boolean;
}): InitialScrollAction {
  if (!args.pending) return 'wait';
  if (args.searchActive) return 'disarm';
  if (args.isLoading) return 'wait';
  if (!args.hasMessages) return args.hydrated ? 'disarm' : 'wait';
  return 'scroll';
}
