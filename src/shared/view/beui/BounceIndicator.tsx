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

function quadraticBezier(start: number, control: number, end: number, progress: number) {
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
  const activeKeyRef = useRef(activeKey);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  activeKeyRef.current = activeKey;

  const measure = useCallback((key: string): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    // A key can be stamped on both the mobile and desktop variant of a row
    // (one is display:none per breakpoint); measure the visible one.
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
    return rowRect.top - containerRect.top + (rowRect.height - DOT_SIZE) / 2;
  }, [containerRef]);

  /** Re-seat the dot with no travel (layout shifted around it). */
  const snapIndicator = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    const destinationY = measure(key);
    if (destinationY === null) {
      // Destination row left the layout (collapsed group, filtered list):
      // fade out rather than hover stale or vanish in a hard cut; the next
      // resize with the row back re-seats the dot.
      animationRef.current?.stop();
      animate(opacity, 0, FADE);
      hasPositionRef.current = false;
      return;
    }
    animationRef.current?.stop();
    if (!hasPositionRef.current) {
      // Reappearing (project re-expanded): seat silently, then fade in.
      x.set(0);
      y.set(destinationY);
      animate(opacity, 1, FADE);
    } else {
      x.set(0);
      y.set(destinationY);
      opacity.set(1);
    }
    hasPositionRef.current = true;
  }, [measure, opacity, x, y]);

  useLayoutEffect(() => {
    if (!activeKey) {
      animationRef.current?.stop();
      animate(opacity, 0, FADE);
      hasPositionRef.current = false;
      return;
    }

    const destinationY = measure(activeKey);
    if (destinationY === null) {
      animate(opacity, 0, FADE);
      hasPositionRef.current = false;
      return;
    }

    animationRef.current?.stop();
    opacity.set(1);

    if (!hasPositionRef.current || reduce) {
      x.set(0);
      y.set(destinationY);
      hasPositionRef.current = true;
      return;
    }

    const startY = y.get();
    const distance = destinationY - startY;
    const travel = Math.abs(distance);
    if (travel < 1) {
      y.set(destinationY);
      return;
    }
    const longJumpProgress = Math.min(1, Math.max(0, (travel - 48) / 120));
    const controlX = -Math.min(40, Math.max(8, travel * 0.25));
    const midpointY = (startY + destinationY) / 2;
    const controlY = destinationY + (midpointY - destinationY) * longJumpProgress;

    animationRef.current = animate(0, 1, {
      ...BOUNCE_SPRING,
      stiffness: BOUNCE_SPRING.stiffness - 60 * longJumpProgress,
      damping: BOUNCE_SPRING.damping + longJumpProgress,
      mass: BOUNCE_SPRING.mass + 0.15 * longJumpProgress,
      onUpdate: (progress) => {
        x.set(quadraticBezier(0, controlX, 0, progress));
        y.set(quadraticBezier(startY, controlY, destinationY, progress));
      },
      onComplete: () => {
        x.set(0);
        y.set(destinationY);
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
  }, []);

  return (
    <motion.span
      aria-hidden="true"
      style={{ x, y, opacity }}
      className={cn(
        'pointer-events-none absolute left-1 top-0 h-1.5 w-1.5 rounded-full bg-primary',
        className,
      )}
    />
  );
}
