import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertTriangle,
  Check,
  Circle,
  Info,
  LoaderCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';

import { cn } from '../../../lib/utils';
import { EASE_OUT } from '../beui/ease';

// beUI animated-badge (beui.dev/components/motion/animated-badge), folded into
// the app badge: donor spacing/typography/motion verbatim; colors and radius
// mapped to app tokens. The static path keeps the original cva API; passing
// `status` opts into the donor's animated state-icon treatment.

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export type BadgeStatus = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'loading';

export type BadgeSize = 'sm' | 'md';

const STATUS_CLASS: Record<BadgeStatus, string> = {
  neutral: 'border-border bg-card text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  loading: 'border-primary/30 bg-primary/10 text-primary',
};

const SIZE_CLASS: Record<BadgeSize, string> = {
  sm: 'h-6 gap-1.5 px-2 text-[11px]',
  md: 'h-8 gap-2 px-3 text-xs',
};

const ICON_CLASS: Record<BadgeSize, string> = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
};

const ICONS: Record<BadgeStatus, LucideIcon> = {
  neutral: Circle,
  info: Info,
  success: Check,
  warning: AlertTriangle,
  danger: X,
  loading: LoaderCircle,
};

const ICON_ROLL_VARIANTS: Variants = {
  initial: {
    opacity: 0.72,
    y: '80%',
    scale: 0.92,
    rotate: -8,
    filter: 'blur(6px)',
  },
  animate: {
    opacity: 1,
    y: '0%',
    scale: 1,
    rotate: 0,
    filter: 'blur(0px)',
    transition: {
      y: { type: 'spring', stiffness: 210, damping: 24, mass: 0.85 },
      scale: { type: 'spring', stiffness: 250, damping: 24, mass: 0.75 },
      rotate: { duration: 0.28, ease: EASE_OUT },
      opacity: { duration: 0.28, ease: EASE_OUT },
      filter: { duration: 0.42, ease: EASE_OUT },
    },
  },
  exit: {
    opacity: 0.5,
    y: '-80%',
    scale: 0.96,
    rotate: 8,
    filter: 'blur(6px)',
    transition: { duration: 0.22, ease: EASE_OUT },
  },
};

const TEXT_ROLL_VARIANTS: Variants = {
  initial: { opacity: 0.76, y: '85%', filter: 'blur(6px)' },
  animate: {
    opacity: 1,
    y: '0%',
    filter: 'blur(0px)',
    transition: {
      y: { type: 'spring', stiffness: 210, damping: 24, mass: 0.85 },
      opacity: { duration: 0.3, ease: EASE_OUT },
      filter: { duration: 0.42, ease: EASE_OUT },
    },
  },
  exit: {
    opacity: 0.5,
    y: '-85%',
    filter: 'blur(6px)',
    transition: { duration: 0.2, ease: EASE_OUT },
  },
};

type BadgeProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof badgeVariants> & {
    /** Opt-in animated state treatment (beUI animated-badge). */
    status?: BadgeStatus;
    size?: BadgeSize;
    icon?: React.ReactNode;
    showIcon?: boolean;
    pulse?: boolean;
    contentKey?: string | number;
  };

function Badge({
  className,
  variant,
  status,
  size = 'sm',
  icon,
  showIcon = true,
  pulse,
  contentKey,
  children,
  ...props
}: BadgeProps) {
  const reduce = useReducedMotion();

  if (!status) {
    return (
      <div className={cn(badgeVariants({ variant }), className)} {...props}>
        {children}
      </div>
    );
  }

  const shouldPulse = pulse ?? status === 'loading';
  const Icon = ICONS[status];
  const resolvedContentKey =
    contentKey ??
    (typeof children === 'string' || typeof children === 'number' ? children : status);
  // Motion redefines these handlers with its own signatures; the animated badge
  // never receives them, so they are dropped before spreading.
  const { onDrag, onDragStart, onDragEnd, onAnimationStart, ...rest } = props;
  void onDrag;
  void onDragStart;
  void onDragEnd;
  void onAnimationStart;

  return (
    <motion.span
      layout
      transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }}
      className={cn(
        'relative inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border font-medium tabular-nums',
        'transition-colors duration-300',
        STATUS_CLASS[status],
        SIZE_CLASS[size],
        className
      )}
      {...rest}
    >
      {shouldPulse && !reduce ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-current opacity-10"
          animate={{ scale: [0.94, 1.08, 0.94], opacity: [0.08, 0.16, 0.08] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}
      {showIcon ? (
        <span className="relative z-10 inline-flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              aria-hidden
              data-badge-icon
              variants={ICON_ROLL_VARIANTS}
              initial={reduce ? false : 'initial'}
              animate={reduce ? { opacity: 1 } : 'animate'}
              exit={reduce ? undefined : 'exit'}
              className="inline-flex will-change-transform"
            >
              {status === 'loading' && !reduce && !icon ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="inline-flex"
                >
                  <Icon className={ICON_CLASS[size]} />
                </motion.span>
              ) : (
                (icon ?? <Icon className={ICON_CLASS[size]} />)
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : null}
      {children != null ? (
        <span className="relative z-10 inline-flex overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={resolvedContentKey}
              data-badge-label
              variants={TEXT_ROLL_VARIANTS}
              initial={reduce ? false : 'initial'}
              animate={reduce ? { opacity: 1 } : 'animate'}
              exit={reduce ? undefined : 'exit'}
              className="inline-block will-change-transform"
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : null}
    </motion.span>
  );
}

export { Badge, badgeVariants };
