import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

// beUI bounce-sidebar behavior (beui.dev/components/motion/bounce-sidebar),
// vendored and adapted: the donor tracks its own <li> registry; this app's
// sidebar rows live in an existing tree, so the dot finds its destination by
// a `data-bounce-key` stamp inside the host container instead. The physics —
// a compact, lightly underdamped spring whose sideways quadratic-bezier arc
// carries the bounce — are the donor's, unchanged.

const DOT_SIZE = 6;

/** Fade used when the dot's destination row leaves or re-enters the layout. */
const FADE = { duration: 0.15, ease: 'easeOut' } as const;

const BOUNCE_SPRING = {
  type: 'spring',
  stiffness: 280,
  damping: 18,
  mass: 0.3,
} as const;

// Exported for the regression test that pins the restored motion curve.
// eslint-disable-next-line react-refresh/only-export-components
export function quadraticBezier(start: number, control: number, end: number, progress: number) {
  const remaining = 1 - progress;
  return (
    remaining * remaining * start +
    2 * remaining * progress * control +
    progress * progress * end
  );
}

type BounceIndicatorProps = {
  /**
   * Key of the destination row: the dot arcs to the element stamped
   * `data-bounce-key=<activeKey>` inside `containerRef`. Null hides the dot.
   */
  activeKey: string | null;
  /** The positioned (relative) ancestor the dot is absolutely placed in. */
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
};

export function BounceIndicator({ activeKey, containerRef, className }: BounceIndicatorProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);
  const hasPositionRef = useRef(false);
  const travelingRef = useRef(false);
  const activeKeyRef = useRef(activeKey);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  activeKeyRef.current = activeKey;

  const measure = useCallback((key: string): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (!container) return null;
    // Guard against a key stamped on a hidden duplicate (display:none per
    // breakpoint); measure the visible element.
    const rows = container.querySelectorAll<HTMLElement>(`[data-bounce-key="${CSS.escape(key)}"]`);
    let row: HTMLElement | null = null;
    for (const candidate of rows) {
      if (candidate.getBoundingClientRect().height > 0) {
        row = candidate;
        break;
      }
    }
    if (!row) return null;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // A collapsing project clips its session rows behind an overflow-hidden
    // height animation before removing them; the rect alone stays full-size
    // the whole time. Intersect with clipping ancestors (up to the container)
    // so the dot counts as gone the moment the clip edge swallows its row,
    // in sync with the collapse instead of after DOM removal.
    let clipTop = -Infinity;
    let clipBottom = Infinity;
    for (let node = row.parentElement; node && node !== container; node = node.parentElement) {
      if (getComputedStyle(node).overflowY !== 'visible') {
        const clipRect = node.getBoundingClientRect();
        clipTop = Math.max(clipTop, clipRect.top);
        clipBottom = Math.min(clipBottom, clipRect.bottom);
      }
    }
    const rowCenterY = rowRect.top + rowRect.height / 2;
    if (rowCenterY < clipTop || rowCenterY > clipBottom) return null;
    // The x offset seats the dot against the destination row's own left
    // edge, not the container's, so indented rows (a chat nested under a
    // project) keep the dot inside their padding instead of at the pane edge.
    return {
      x: rowRect.left - containerRect.left,
      y: rowRect.top - containerRect.top + (rowRect.height - DOT_SIZE) / 2,
    };
  }, [containerRef]);

  /** Re-seat the dot with no travel (layout shifted around it). */
  const snapIndicator = useCallback(() => {
    // Selection updates can add/remove response marks inside a row. That
    // child-list mutation must not cancel the dot's own in-flight spring.
    if (travelingRef.current) return;
    const key = activeKeyRef.current;
    if (!key) return;
    const destination = measure(key);
    if (destination === null) {
      // Destination row left the layout (collapsed group, filtered list):
      // hide with a hard cut — the rows below are already sliding up over
      // this spot, so a fade floats over unrelated rows. The next resize
      // with the row back re-seats the dot.
      animationRef.current?.stop();
      travelingRef.current = false;
      opacity.set(0);
      hasPositionRef.current = false;
      return;
    }
    animationRef.current?.stop();
    if (!hasPositionRef.current) {
      // Reappearing (project re-expanded): seat silently, then fade in.
      x.set(destination.x);
      y.set(destination.y);
      animate(opacity, 1, FADE);
    } else {
      x.set(destination.x);
      y.set(destination.y);
      opacity.set(1);
    }
    hasPositionRef.current = true;
  }, [measure, opacity, x, y]);

  useLayoutEffect(() => {
    if (!activeKey) {
      animationRef.current?.stop();
      travelingRef.current = false;
      animate(opacity, 0, FADE);
      hasPositionRef.current = false;
      return;
    }

    const destination = measure(activeKey);
    if (destination === null) {
      animationRef.current?.stop();
      travelingRef.current = false;
      animate(opacity, 0, FADE);
      hasPositionRef.current = false;
      return;
    }

    animationRef.current?.stop();
    travelingRef.current = false;
    opacity.set(1);

    if (!hasPositionRef.current || reduce) {
      x.set(destination.x);
      y.set(destination.y);
      hasPositionRef.current = true;
      return;
    }

    const startX = x.get();
    const startY = y.get();
    const distance = destination.y - startY;
    const travel = Math.abs(distance);
    if (travel < 1) {
      x.set(destination.x);
      y.set(destination.y);
      return;
    }
    const longJumpProgress = Math.min(1, Math.max(0, (travel - 48) / 120));
    // The sideways bulge rides on the straight-line x travel between the two
    // rows' left edges (zero travel when both rows share an indent).
    const controlX = (startX + destination.x) / 2 - Math.min(40, Math.max(8, travel * 0.25));
    const midpointY = (startY + destination.y) / 2;
    const controlY = destination.y + (midpointY - destination.y) * longJumpProgress;

    travelingRef.current = true;
    animationRef.current = animate(0, 1, {
      ...BOUNCE_SPRING,
      stiffness: BOUNCE_SPRING.stiffness - 60 * longJumpProgress,
      damping: BOUNCE_SPRING.damping + longJumpProgress,
      mass: BOUNCE_SPRING.mass + 0.15 * longJumpProgress,
      onUpdate: (progress) => {
        x.set(quadraticBezier(startX, controlX, destination.x, progress));
        y.set(quadraticBezier(startY, controlY, destination.y, progress));
      },
      onComplete: () => {
        x.set(destination.x);
        y.set(destination.y);
        travelingRef.current = false;
      },
    });
  }, [activeKey, measure, opacity, reduce, x, y]);

  // Rows above the destination expand, collapse, and reflow constantly; a
  // container resize re-seats the dot without replaying the arc. Row mount and
  // unmount (collapsing a project, filtering the list) don't always change the
  // container's size — a collapse wrapper animates to height 0 before the row
  // leaves the DOM — so DOM mutations re-seat (or hide) the dot too. This is a
  // passive useEffect, not a layout effect: the dot is a child of the host
  // container, so its layout effects run before the container's ref attaches
  // and would observe nothing. The snapIndicator call seats the dot on mount
  // for the same reason (the layout effect above ran against a null ref).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    snapIndicator();
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(snapIndicator);
      resizeObserver.observe(container);
      observers.push(resizeObserver);
    }
    if (typeof MutationObserver !== 'undefined') {
      const mutationObserver = new MutationObserver(snapIndicator);
      mutationObserver.observe(container, { childList: true, subtree: true });
      observers.push(mutationObserver);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [containerRef, snapIndicator]);

  useLayoutEffect(() => () => {
    animationRef.current?.stop();
    travelingRef.current = false;
  }, []);

  return (
    <motion.span
      aria-hidden="true"
      data-slot="bounce-indicator"
      style={{ x, y, opacity }}
      className={cn(
        'pointer-events-none absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-primary',
        className,
      )}
    />
  );
}
