import { motion } from 'motion/react';
import { useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

import { EASE_IN_OUT } from './ease';

// beUI Loader (beui.dev/components/motion/loader), vendored per the fidelity
// law and trimmed to the two variants this app uses on loading overlays:
// dot-matrix (3x3 diagonal wave) and dither (Bayer 4x4 halftone dissolve).
// Everything renders in currentColor and scales from the `size` prop; reduced
// motion drops every transform for a calm opacity pulse.

export type LoaderVariant = 'dot-matrix' | 'dither';

export interface LoaderProps {
  /** Which animation to render. */
  variant?: LoaderVariant;
  /** Base square size in px. Everything scales from this. */
  size?: number;
  /** Seconds per animation cycle. */
  speed?: number;
  /** Accessible label announced to screen readers. */
  label?: string;
  className?: string;
}

export function Loader({
  variant = 'dot-matrix',
  size = 32,
  speed = 1,
  label = 'Loading',
  className,
}: LoaderProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <span
      role="status"
      aria-label={label}
      data-slot="loader"
      className={cn(
        'inline-flex items-center justify-center text-foreground',
        className,
      )}
    >
      {variant === 'dot-matrix' && (
        <DotMatrix size={size} speed={speed} reduce={reduce} />
      )}
      {variant === 'dither' && <Dither size={size} speed={speed} reduce={reduce} />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface PartProps {
  size: number;
  speed: number;
  reduce: boolean;
}

function DotMatrix({ size, speed, reduce }: PartProps) {
  const n = 3;
  const gap = size * 0.14;
  const dot = (size - gap * (n - 1)) / n;
  const cells = Array.from({ length: n * n }, (_, idx) => idx);
  return (
    <span
      className="grid"
      style={{
        gap,
        gridTemplateColumns: `repeat(${n}, ${dot}px)`,
      }}
    >
      {cells.map((idx) => {
        const x = idx % n;
        const y = Math.floor(idx / n);
        // Diagonal wave: cells light in order of their distance from the corner.
        const delay = ((x + y) / (2 * (n - 1))) * speed;
        return (
          <motion.span
            key={idx}
            className="rounded-full bg-current"
            style={{ width: dot, height: dot }}
            animate={
              reduce
                ? { opacity: [0.3, 1, 0.3] }
                : { opacity: [0.2, 1, 0.2], scale: [0.7, 1, 0.7] }
            }
            transition={{
              duration: speed,
              ease: EASE_IN_OUT,
              repeat: Infinity,
              delay,
            }}
          />
        );
      })}
    </span>
  );
}

// Ordered Bayer 4x4 matrix — the classic dithering threshold pattern. Cells
// light in this order, so the fill shimmers like a dissolving halftone.
const BAYER_4 = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
];

function Dither({ size, speed, reduce }: PartProps) {
  const n = 4;
  const gap = Math.max(1, size * 0.05);
  const cell = (size - gap * (n - 1)) / n;
  return (
    <span
      className="grid"
      style={{ gap, gridTemplateColumns: `repeat(${n}, ${cell}px)` }}
    >
      {BAYER_4.map((order, idx) => (
        <motion.span
          // Fixed matrix cells, order never changes.
          key={idx}
          className="bg-current"
          style={{ width: cell, height: cell }}
          animate={reduce ? { opacity: [0.3, 1, 0.3] } : { opacity: [0.1, 1, 0.1] }}
          transition={{
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity,
            delay: (order / BAYER_4.length) * speed,
          }}
        />
      ))}
    </span>
  );
}
