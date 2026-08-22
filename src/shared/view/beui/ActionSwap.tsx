import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Variants } from 'motion/react';

import { cn } from '../../../lib/utils';

import { EASE_OUT, SPRING_SWAP } from './ease';

// beUI Action Swap icon slot (beui.dev/components/motion/action-swap),
// vendored per the fidelity law: the leaving and landing icons overlap in one
// grid cell and trade places through the donor's blur/scale (or roll) motion,
// so state changes never hard-cut. Text swaps live in SwapText.tsx.

export type ActionSwapAnimation = 'blur' | 'roll';

const BLUR_TRANSITION = { duration: 0.2, ease: 'easeInOut' } as const;
const SWAP_BLUR = 'blur(8px)';
const ROLL_BLUR = 'blur(3px)';
const ROLL_EXIT_TRANSITION = { duration: 0.14, ease: EASE_OUT } as const;

const ICON_VARIANTS: Record<ActionSwapAnimation, Variants> = {
  blur: {
    initial: { opacity: 0, scale: 0.25, filter: SWAP_BLUR },
    animate: {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: BLUR_TRANSITION,
    },
    exit: {
      opacity: 0,
      scale: 0.25,
      filter: SWAP_BLUR,
      transition: BLUR_TRANSITION,
    },
  },
  roll: {
    initial: { opacity: 0, y: 12, filter: ROLL_BLUR },
    animate: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: SPRING_SWAP,
    },
    exit: {
      opacity: 0,
      y: -12,
      filter: ROLL_BLUR,
      transition: ROLL_EXIT_TRANSITION,
    },
  },
};

export interface ActionSwapIconProps {
  /** Identity of the current icon; a change plays the swap. */
  value: string;
  children: ReactNode;
  animation?: ActionSwapAnimation;
  className?: string;
}

export function ActionSwapIcon({
  value,
  children,
  animation = 'blur',
  className,
}: ActionSwapIconProps) {
  const reduce = useReducedMotion();

  return (
    <span
      data-slot="action-swap-icon"
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden', className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={`${animation}-${value}`}
          aria-hidden
          variants={ICON_VARIANTS[animation]}
          initial={reduce ? false : 'initial'}
          animate={reduce ? { opacity: 1, filter: 'blur(0px)', scale: 1, y: 0 } : 'animate'}
          exit={reduce ? undefined : 'exit'}
          className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,filter,transform]"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
