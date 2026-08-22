import { useEffect, useState } from 'react';

import { cn } from '../../../lib/utils';

// beUI Loader, `ascii-braille` variant (beui.dev/components/motion/loader),
// laid out horizontally: a short row of glyph cells stepping through the same
// terminal frame set, each cell one frame behind the last, so the wave reads
// left-to-right. Glyph swaps are text content, not motion, so reduced motion
// only slows the cycle (the donor's rule).
const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

export interface BrailleLoaderProps {
  /** Number of glyph cells in the horizontal row. */
  cells?: number;
  /** Font size in px of each glyph. */
  size?: number;
  /** Seconds per full frame cycle. */
  speed?: number;
  /** Accessible label announced to screen readers. */
  label?: string;
  className?: string;
}

export function BrailleLoader({
  cells = 3,
  size = 12,
  speed = 0.8,
  label = 'Loading',
  className,
}: BrailleLoaderProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = ((reduce ? speed * 2.5 : speed) / BRAILLE_FRAMES.length) * 1000;
    const id = setInterval(() => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length), step);
    return () => clearInterval(id);
  }, [speed]);

  return (
    <span
      role="status"
      aria-label={label}
      data-slot="braille-loader"
      className={cn('inline-flex items-center justify-center gap-px', className)}
    >
      {Array.from({ length: cells }, (_, cell) => (
        <span
          key={cell}
          aria-hidden="true"
          className="font-mono leading-none"
          style={{ fontSize: size, lineHeight: 1 }}
        >
          {BRAILLE_FRAMES[(frame + BRAILLE_FRAMES.length - cell) % BRAILLE_FRAMES.length]}
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
