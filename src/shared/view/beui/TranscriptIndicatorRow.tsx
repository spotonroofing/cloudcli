import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

import { SPRING_SWAP } from './ease';
import { TEXT_SHIMMER_CLASS_NAME, TEXT_SHIMMER_KEYFRAMES, textShimmerStyle } from './textShimmer';

export interface TranscriptIndicatorRowProps {
  glyph?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  duration?: ReactNode;
  affordance?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onDetailClick?: () => void;
  active?: boolean;
  leadingClassName?: string;
  kind?: string;
  role?: 'status';
  testId?: string;
}

/**
 * The single header anatomy for transcript indicators. Callers supply only
 * their glyph, label, muted detail and metadata; spacing, type, ink, radius,
 * duration placement and the disclosure affordance stay identical.
 */
export function TranscriptIndicatorRow({
  glyph,
  label,
  detail,
  meta,
  duration,
  affordance,
  expandable = false,
  expanded = false,
  onToggle,
  onDetailClick,
  active = false,
  leadingClassName,
  kind,
  role,
  testId,
}: TranscriptIndicatorRowProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const interactive = expandable && Boolean(onToggle);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (interactive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onToggle?.();
    }
  };

  return (
    <>
      {active && <style>{TEXT_SHIMMER_KEYFRAMES}</style>}
      <div
      data-slot="transcript-indicator-row"
      data-kind={kind}
      data-testid={testId}
      role={role ?? (interactive ? 'button' : undefined)}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={interactive ? onToggle : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/indicator flex min-h-7 w-full items-center gap-2 rounded-md py-0.5 text-left text-xs text-foreground/90 outline-none',
        interactive && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('grid size-4 shrink-0 place-items-center text-muted-foreground', leadingClassName)}
      >
        {glyph}
      </span>
      <span
        className={cn(
          'shrink-0 whitespace-nowrap font-medium',
          active && TEXT_SHIMMER_CLASS_NAME,
        )}
        style={active ? textShimmerStyle(1.4) : undefined}
      >
        {label}
      </span>
      {detail !== undefined ? (
        onDetailClick ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDetailClick();
            }}
            className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-primary hover:underline"
          >
            {detail}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
            {detail}
          </span>
        )
      ) : (
        <span aria-hidden="true" className="min-w-0 flex-1" />
      )}
      {meta && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          {meta}
        </span>
      )}
      {duration}
      <span aria-hidden={affordance ? undefined : true} className="grid size-4 shrink-0 place-items-center">
        {affordance ?? (expandable && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
            className="text-muted-foreground/50 transition-colors group-hover/indicator:text-muted-foreground"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        ))}
      </span>
      </div>
    </>
  );
}
