// Pane drop highlight (ui17 job 6). The browser fires a dragleave for the
// element the pointer left on every hop between nested children, so anything
// that reads a single boolean flickers while a file is held over the pane.
// This tracker keeps the set of entered targets that still live inside the
// pane and stays active until the last one leaves, a drop lands, or the drag
// ends. It owns no DOM of its own so it can be driven from a test.

export interface PaneDragTracker {
  /** dragenter on `target`; returns whether the highlight should be shown. */
  enter(target: unknown): boolean;
  /** dragleave from `target`; returns whether the highlight should be shown. */
  leave(target: unknown): boolean;
  /** drop, dragend, or unmount; always clears the highlight. */
  end(): boolean;
  readonly active: boolean;
}

/**
 * @param contains tells whether a previously entered target is still a node
 *   inside the pane. Targets that fail it (a child unmounted mid-drag, or an
 *   event that arrived while the pane was detached) are dropped from the set.
 */
export function createPaneDragTracker(contains: (target: unknown) => boolean): PaneDragTracker {
  let targets: unknown[] = [];

  const prune = () => {
    targets = targets.filter((target) => contains(target));
  };

  return {
    enter(target) {
      prune();
      // Firefox can fire dragenter twice for the same element; one entry per
      // target keeps the count honest against the single matching dragleave.
      if (!targets.includes(target)) targets.push(target);
      return targets.length > 0;
    },
    leave(target) {
      prune();
      const index = targets.indexOf(target);
      if (index !== -1) targets.splice(index, 1);
      return targets.length > 0;
    },
    end() {
      targets = [];
      return false;
    },
    get active() {
      return targets.length > 0;
    },
  };
}
