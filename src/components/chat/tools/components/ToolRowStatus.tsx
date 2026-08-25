import { CircleSlash, CircleX } from 'lucide-react';

import { cn } from '../../../../lib/utils';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

/** First non-empty line of a tool error, for the row's description slot. */
export function firstErrorLine(content: unknown): string {
  const text = String(content ?? '');
  return text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) || '';
}

/**
 * Leading status icon for tool rows (ui12 job 10): the Running/Error tag chips
 * are gone — a running row leads with the shared ramped arc spinner, an
 * errored row with a red status glyph, a denied row with an amber slash
 * (semantic colors per ui12 phase 4). Completed rows render nothing.
 */
export function ToolRowStatusIcon({ status, className }: { status: ToolStatus; className?: string }) {
  if (status === 'running') {
    return (
      <svg
        role="status"
        aria-label="Running"
        viewBox="0 0 24 24"
        data-slot="tool-status-running"
        className={cn('size-3.5 shrink-0 overflow-visible text-status-working', className)}
      >
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
        <g
          className="animate-spinner-ramp"
          style={{ transformOrigin: '12px 12px', transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            pathLength="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="0.68 1"
          />
        </g>
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <CircleX
        aria-label="Error"
        data-slot="tool-status-error"
        className={cn('size-3.5 shrink-0 text-rose-600 dark:text-rose-400', className)}
      />
    );
  }
  if (status === 'denied') {
    return (
      <CircleSlash
        aria-label="Denied"
        data-slot="tool-status-denied"
        className={cn('size-3.5 shrink-0 text-amber-600 dark:text-amber-500', className)}
      />
    );
  }
  return null;
}
