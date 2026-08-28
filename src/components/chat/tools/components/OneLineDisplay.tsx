import React from 'react';
import { ChevronDown } from 'lucide-react';

import { TranscriptIndicatorRow } from '../../../../shared/view/beui';

import { ToolGlyph } from './ToolGlyph';
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
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  toolResult,
  toolId,
  status,
  durationMeta,
}) => {
  const labelText = label || toolName;
  const displayValue = action === 'open-file' ? value.split('/').pop() || value : value;
  const detail = secondary ? `${displayValue} · ${secondary}` : displayValue;

  return (
    <div className="my-0.5">
      <TranscriptIndicatorRow
        kind={toolName.toLowerCase()}
        glyph={status ? <ToolRowStatusIcon status={status} /> : <ToolGlyph toolName={toolName} />}
        label={labelText}
        detail={detail}
        onDetailClick={action === 'open-file' ? onAction : undefined}
        duration={durationMeta}
        affordance={action === 'jump-to-results' && toolResult ? (
          <a
            href={`#tool-result-${toolId}`}
            aria-label="Jump to tool result"
            className="text-primary transition-colors hover:text-primary/80"
          >
            <ChevronDown className="size-3.5" />
          </a>
        ) : undefined}
      />
    </div>
  );
};
