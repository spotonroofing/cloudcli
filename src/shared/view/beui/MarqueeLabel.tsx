import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

import { EASE_IN_OUT, EASE_OUT } from './ease';

// beUI overflow-aware row label (beui.dev/components/agents/ai-sidebar),
// vendored verbatim per the fidelity law: an overflowing label scrolls as a
// looping marquee while `active` (row hovered or its menu open) instead of
// truncating; labels that fit never move.

// Pointer-leave return (ui14 job 12): the scan stops immediately and slides
// back to rest on a short ramped ease — long enough to read as a slide back,
// never a blink.
const ROW_RETURN = { duration: 0.4, ease: EASE_OUT } as const;

export function MarqueeLabel({
  active,
  activateOnParentHover = false,
  children,
  className,
  mode = 'loop',
  startDelay = 0,
  stopImmediately = false,
}: {
  active: boolean;
  /** Listen to the nearest data-marquee-hover host without re-rendering it. */
  activateOnParentHover?: boolean;
  children: string;
  className?: string;
  /** Jobs task rows scan to the end once, then return; navigation rows loop. */
  mode?: 'loop' | 'once';
  /** Hover-driven labels can pause briefly before motion begins. */
  startDelay?: number;
  /** Pointer-leave can snap a hover scan to rest in the same frame. */
  stopImmediately?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  const [parentHovered, setParentHovered] = useState(false);

  useEffect(() => {
    if (!activateOnParentHover) return;
    const host = viewportRef.current?.closest<HTMLElement>('[data-marquee-hover]');
    if (!host) return;
    const enter = () => setParentHovered(true);
    const leave = () => setParentHovered(false);
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
    };
  }, [activateOnParentHover]);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const label = labelRef.current;
      if (!viewport || !label) return;
      setDistance(
        label.scrollWidth > viewport.clientWidth
          ? mode === 'once'
            ? label.scrollWidth - viewport.clientWidth
            : label.scrollWidth + 24
          : 0,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (labelRef.current) observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, [mode]);

  const running = (active || parentHovered) && distance > 0 && !reduce;

  return (
    <span
      ref={viewportRef}
      data-marquee-mode={mode}
      className={cn('block min-w-0 flex-1 overflow-hidden', className)}
    >
      <motion.span
        className="flex w-max items-center gap-6 whitespace-nowrap"
        animate={{ x: running ? [0, -distance, 0] : 0 }}
        transition={
          running
            ? mode === 'once'
              ? {
                  duration: Math.max(2.4, distance / 28) * 2,
                  ease: EASE_IN_OUT,
                  times: [0, 0.5, 1],
                  delay: startDelay,
                }
              : {
                duration: Math.max(2.4, distance / 34) * 2,
                ease: EASE_IN_OUT,
                times: [0, 0.5, 1],
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 2,
                delay: startDelay,
              }
            : stopImmediately ? { duration: 0 } : ROW_RETURN
        }
      >
        <span ref={labelRef}>{children}</span>
        {/* The loop copy stays mounted through the return slide; unmounting it
            on leave blanks the viewport when the scan is past the first copy. */}
        {distance > 0 && mode === 'loop' ? <span aria-hidden="true">{children}</span> : null}
      </motion.span>
    </span>
  );
}
