import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '../../../lib/utils';

import { SPRING_PRESS } from './ease';

// beUI Radio (beui.dev/components/motion/radio), vendored with donor
// spacing/sizing/motion verbatim; accent through this app's `primary` token.
// RadioDot is the donor item's ring + gliding layoutId dot exposed on its own,
// for rich option rows that carry more than a label (e.g. AskUserQuestionPanel).

// Donor's shared-layout glide token (not in ease.ts).
export const SPRING_LAYOUT = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

type RadioCtxValue = {
  value: string;
  setValue: (value: string) => void;
  layoutId: string;
};

const RadioCtx = createContext<RadioCtxValue | null>(null);

function useRadioGroup() {
  const ctx = useContext(RadioCtx);
  if (!ctx) {
    throw new Error('RadioGroupItem must be used inside <RadioGroup>');
  }
  return ctx;
}

export interface RadioDotProps {
  selected: boolean;
  /** Shared across one group so the inner dot glides between options. */
  layoutId: string;
  className?: string;
}

export function RadioDot({ selected, layoutId, className }: RadioDotProps) {
  const reduce = useReducedMotion();
  return (
    <span
      aria-hidden
      data-slot="beui-radio"
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
        selected ? 'border-primary' : 'border-muted-foreground/50',
        className,
      )}
    >
      {selected ? (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-1 rounded-full bg-primary"
          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
        />
      ) : null}
    </span>
  );
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

export function RadioGroup({
  value,
  defaultValue = '',
  onValueChange,
  children,
  className,
  orientation = 'vertical',
}: RadioGroupProps) {
  const [internal, setInternal] = useState(defaultValue);
  const layoutId = useId();
  const reduce = useReducedMotion();
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );
  const contextValue = useMemo(
    () => ({ value: current, setValue, layoutId }),
    [current, layoutId, setValue],
  );

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
      <RadioCtx.Provider value={contextValue}>
        <div
          role="radiogroup"
          data-slot="beui-radio-group"
          className={cn(
            'flex gap-3',
            orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
            className,
          )}
        >
          {children}
        </div>
      </RadioCtx.Provider>
    </MotionConfig>
  );
}

export interface RadioGroupItemProps {
  value: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function RadioGroupItem({
  value,
  label,
  disabled,
  className,
  id: idProp,
}: RadioGroupItemProps) {
  const { value: groupValue, setValue, layoutId } = useRadioGroup();
  const autoId = useId();
  const id = idProp ?? autoId;
  const reduce = useReducedMotion();
  const selected = groupValue === value;

  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex items-center gap-3',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <motion.button
        id={id}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => !disabled && setValue(value)}
        whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
        transition={SPRING_PRESS}
        data-slot="beui-radio"
        data-state={selected ? 'checked' : 'unchecked'}
        className={cn(
          'relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 outline-none transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-60',
          selected
            ? 'border-primary'
            : 'border-muted-foreground/50 hover:border-muted-foreground',
        )}
      >
        {selected ? (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-1 rounded-full bg-primary"
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          />
        ) : null}
      </motion.button>
      {label ? (
        <span className={cn('select-none text-sm text-foreground', disabled && 'opacity-60')}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
