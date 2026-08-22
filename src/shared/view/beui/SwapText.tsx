import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

import { EASE_OUT, SPRING_SWAP } from './ease';

// beUI ActionSwapText, roll animation (beui.dev/components/motion/action-swap),
// vendored with only the roll path: the leaving and landing labels overlap as
// independent layers over an invisible sizer, so proportional glyph widths
// never jitter. Used for tool-row status and title swaps.
const ROLL_VARIANTS = {
  initial: { opacity: 0, y: 12, filter: 'blur(3px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: SPRING_SWAP,
  },
  exit: {
    opacity: 0,
    y: -12,
    filter: 'blur(3px)',
    transition: { duration: 0.14, ease: EASE_OUT },
  },
};

export interface SwapTextProps {
  /** Identity of the current content; a change rolls the label. */
  value: string;
  children: ReactNode;
  className?: string;
}

export function SwapText({ value, children, className }: SwapTextProps) {
  const reduce = useReducedMotion();

  return (
    <span
      className={cn(
        'relative -my-[0.08em] inline-block max-w-full whitespace-nowrap py-[0.08em] align-bottom',
        className,
      )}
      style={{
        clipPath: 'inset(0 -999px)',
        WebkitClipPath: 'inset(0 -999px)',
      }}
    >
      <span aria-hidden className="invisible inline-block whitespace-nowrap">
        {children}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={`roll-${value}`}
          variants={ROLL_VARIANTS}
          initial={reduce ? false : 'initial'}
          animate={reduce ? { opacity: 1, filter: 'blur(0px)', y: 0 } : 'animate'}
          exit={reduce ? undefined : 'exit'}
          className="absolute left-0 top-[0.08em] inline-block max-w-full truncate will-change-[opacity,filter,transform]"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
