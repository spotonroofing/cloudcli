// beUI shared motion tokens (beui.dev), vendored verbatim per the fidelity
// law: spacing, sizing, and motion timing are the donor's; only import paths
// are ours. Strong custom variants — defaults like `ease-in`/`ease-out` feel weak.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Press feedback on buttons and other tappable surfaces. */
export const SPRING_PRESS = {
  type: 'spring',
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const;

/** Content swaps — label/icon slots trading places inside a control. */
export const SPRING_SWAP = {
  type: 'spring',
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const;

/** A sent message row rising from the live edge (beUI Message pop-up). */
export const MESSAGE_POP_UP = {
  type: 'spring',
  stiffness: 480,
  damping: 32,
  mass: 0.62,
} as const;
