import { useCallback, useLayoutEffect, useRef } from 'react';
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
    const row = container.querySelector<HTMLElement>(`[data-bounce-key="${CSS.escape(key)}"]`);
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
    if (destinationY === null) return;
    animationRef.current?.stop();
    x.set(0);
    y.set(destinationY);
    opacity.set(1);
    hasPositionRef.current = true;
  }, [measure, opacity, x, y]);

  useLayoutEffect(() => {
    if (!activeKey) {
      animationRef.current?.stop();
      opacity.set(0);
      hasPositionRef.current = false;
      return;
    }

    const destinationY = measure(activeKey);
    if (destinationY === null) {
      opacity.set(0);
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
  // container resize re-seats the dot without replaying the arc.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(snapIndicator);
    observer.observe(container);
    return () => observer.disconnect();
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
