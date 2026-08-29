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
      {/* Label and duration are one group: the duration reads as part of the
          row's own phrase ("Thought for 19.1s", "Bash 0.3s"), never stranded
          at the far right edge away from the word it belongs to. */}
      <span data-slot="indicator-label" className="flex shrink-0 items-baseline gap-1.5">
        <span
          data-slot="indicator-label-text"
          className={cn(
            'whitespace-nowrap font-medium',
            active && TEXT_SHIMMER_CLASS_NAME,
          )}
          style={active ? textShimmerStyle(1.4) : undefined}
        >
          {label}
        </span>
        {duration}
      </span>
      <span data-slot="indicator-detail" className="flex min-w-0 flex-1 items-center gap-2">
        {detail !== undefined && (
          onDetailClick ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDetailClick();
              }}
              className="min-w-0 shrink truncate text-left font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-primary hover:underline"
            >
              {detail}
            </button>
          ) : (
            <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground/70">
              {detail}
            </span>
          )
        )}
        {/* Counts ride with the preview in the preview's own muted style, so
            the trailing slot stays the chevron's alone. */}
        {meta && (
          <span data-slot="indicator-meta" className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {meta}
          </span>
        )}
      </span>
      <span
        data-slot="indicator-affordance"
        aria-hidden={affordance ? undefined : true}
        className="grid size-4 shrink-0 place-items-center"
      >
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
