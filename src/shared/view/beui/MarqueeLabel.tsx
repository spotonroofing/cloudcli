import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

import { EASE_OUT } from './ease';

// beUI overflow-aware row label (beui.dev/components/agents/ai-sidebar),
// vendored verbatim per the fidelity law: an overflowing label scrolls as a
// looping marquee while `active` (row hovered or its menu open) instead of
// truncating; labels that fit never move.

const ROW_REVEAL = { duration: 0.16, ease: EASE_OUT } as const;

export function MarqueeLabel({ active, children, className }: { active: boolean; children: string; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const label = labelRef.current;
      if (!viewport || !label) return;
      setDistance(label.scrollWidth > viewport.clientWidth ? label.scrollWidth + 24 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (labelRef.current) observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, []);

  const running = active && distance > 0 && !reduce;

  return (
    <span ref={viewportRef} className={cn('block min-w-0 flex-1 overflow-hidden', className)}>
      <motion.span
        className="flex w-max items-center gap-6 whitespace-nowrap"
        animate={{ x: running ? [0, -distance] : 0 }}
        transition={
          running
            ? {
                duration: Math.max(2.4, distance / 34),
                ease: 'linear',
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 2,
              }
            : ROW_REVEAL
        }
      >
        <span ref={labelRef}>{children}</span>
        {running ? <span aria-hidden="true">{children}</span> : null}
      </motion.span>
    </span>
  );
}
