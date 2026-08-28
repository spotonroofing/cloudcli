import React from 'react';
import { ToolRowStatusIcon } from './ToolRowStatus';
import type { ToolStatus } from './ToolRowStatus';

type ActionType = 'open-file' | 'jump-to-results' | 'none';

interface OneLineDisplayProps {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  style?: string;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    border?: string;
    icon?: string;
  };
  resultId?: string;
  toolResult?: any;
  toolId?: string;
  status?: ToolStatus;
  durationMeta?: React.ReactNode;
}

/**
 * Unified one-line display for simple tool inputs and results (Read, Grep,
 * Glob minimized, TodoRead, etc.), in the shared tool-row anatomy (ui13 job
 * 13, Bash reference): leading `size-4` icon slot, medium label, mono muted
 * value, `min-h-7` rhythm, and the fixed `size-4` trailing slot.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  wrapText = false,
  colorScheme = {},
  toolResult,
  toolId,
  status,
  durationMeta,
}) => {
  // Fixed size-4 slot at the row's right edge so trailing controls line up
  // with the chevron column of expandable tool rows.
  const chevronSlot = <span aria-hidden="true" className="size-4 flex-shrink-0" />;

  // Leading status slot mirrors the Bash row's `$` slot: always reserved so
  // the label column never shifts when a row goes running → completed.
  const statusSlot = (
    <span className="grid size-4 shrink-0 place-items-center">
      {status && <ToolRowStatusIcon status={status} />}
    </span>
  );

  const labelText = label || toolName;

  // File open style
  if (action === 'open-file') {
    const displayName = value.split('/').pop() || value;
    return (
      <div className="my-0.5 flex min-h-7 items-center gap-2 py-0.5">
        {statusSlot}
        <span className="flex-shrink-0 text-xs font-medium text-foreground/90">{labelText}</span>
        <button
          onClick={onAction}
          className="truncate font-mono text-[11px] text-primary transition-colors hover:text-primary/80 hover:underline"
        >
          {displayName}
        </button>
        <span className="ml-auto flex flex-shrink-0 items-center gap-1">
          {durationMeta}
          {chevronSlot}
        </span>
      </div>
    );
  }

  // Search / jump-to-results style
  if (action === 'jump-to-results') {
    return (
      <div className="my-0.5 flex min-h-7 items-center gap-2 py-0.5">
        {statusSlot}
        <span className="flex-shrink-0 text-xs font-medium text-foreground/90">{labelText}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {value}
        </span>
        {secondary && (
          <span className="flex-shrink-0 text-[11px] italic text-muted-foreground/70">
            {secondary}
          </span>
        )}
        {durationMeta}
        {toolResult ? (
          <a
            href={`#tool-result-${toolId}`}
            className="grid size-4 flex-shrink-0 place-items-center text-primary transition-colors hover:text-primary/80"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        ) : chevronSlot}
      </div>
    );
  }

  // Default one-line style
  return (
    <div className={`flex min-h-7 items-center gap-2 ${colorScheme.background || ''} my-0.5 py-0.5`}>
      {statusSlot}
      {icon && icon !== 'terminal' && (
        <span className="flex-shrink-0 text-xs text-muted-foreground">{icon}</span>
      )}
      {!icon && labelText && (
        <span className="flex-shrink-0 text-xs font-medium text-foreground/90">{labelText}</span>
      )}
      <span className={`font-mono text-[11px] text-muted-foreground/70 ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'} min-w-0 flex-1`}>
        {value}
      </span>
      {secondary && (
        <span className="flex-shrink-0 text-[11px] italic text-muted-foreground/70">
          {secondary}
        </span>
      )}
      {durationMeta}
      {chevronSlot}
    </div>
  );
};
