/**
 * The one class set every pane top bar wears (ui14 job 12): planner, worker,
 * files, source control, and the empty state. The `.pane-header` rule in
 * index.css pins the bar's exact height (with the phone safe-area clearance
 * baked in), so no per-pane control can make one bar taller than another.
 */
export const PANE_HEADER_CLASS =
  'pane-header flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-border/60 bg-muted/30 px-3';
