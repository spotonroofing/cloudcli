import React, { useEffect, useRef, useState } from 'react';

import { cn } from '../../../../lib/utils';
import { AgentDisclosure, TranscriptIndicatorRow } from '../../../../shared/view/beui';

import { ToolRowStatusIcon } from './ToolRowStatus';
import type { ToolStatus } from './ToolRowStatus';

interface BashCommandDisplayProps {
  command: string;
  description?: string;
  /** Combined stdout/stderr from the tool result (empty while running). */
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  defaultOpen?: boolean;
  durationMeta?: React.ReactNode;
}

/**
 * Command row in the beUI tool-result terminal treatment (beui.dev/components/
 * agents/tool-result): a compact header — `$`, the command, status — with a
 * spring-rotated chevron on the right when there is output to expand; the
 * output reveals through AgentDisclosure inside a rounded muted viewport.
 */
export const BashCommandDisplay: React.FC<BashCommandDisplayProps> = ({
  command,
  description,
  output,
  isError = false,
  status,
  defaultOpen = false,
  durationMeta,
}) => {
  const trimmedOutput = (output || '').replace(/\s+$/, '');
  const hasOutput = trimmedOutput.length > 0;
  const outputLineCount = hasOutput ? trimmedOutput.split('\n').length : 0;
  const isRunning = status === 'running';
  const [open, setOpen] = useState(false);

  // Output often arrives after this component first mounts, so apply the
  // auto-open intent once when there is finally something to show. After that
  // the user is in control of the toggle. Errors intentionally do NOT
  // auto-expand — the leading status icon and error line already signal the
  // failure, and the output stays one click away.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoAppliedRef.current && hasOutput && defaultOpen) {
      autoAppliedRef.current = true;
      setOpen(true);
    }
  }, [hasOutput, defaultOpen]);

  const toggle = () => {
    if (hasOutput) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div className="group/cmd my-0.5 w-full text-sm">
      <TranscriptIndicatorRow
        kind="bash"
        glyph={status ? <ToolRowStatusIcon status={status} /> : <span className="font-mono font-semibold">$</span>}
        label="Bash"
        detail={command}
        meta={!open && hasOutput && !isRunning
          ? `${outputLineCount} ${outputLineCount === 1 ? 'line' : 'lines'}`
          : undefined}
        duration={durationMeta}
        expandable={hasOutput}
        expanded={open}
        onToggle={toggle}
      />

      {/* Expanded output */}
      <AgentDisclosure open={open && hasOutput}>
        <div className="pl-6 pt-1.5">
          {description && (
            <div className="pb-1 text-[11px] italic text-muted-foreground/70">{description}</div>
          )}
          <div className="overflow-hidden rounded-lg bg-muted/80">
            <pre
              className={cn(
                'max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed',
                isError ? 'text-red-600 dark:text-red-400' : 'text-foreground/80',
              )}
            >
              {trimmedOutput}
            </pre>
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
};
