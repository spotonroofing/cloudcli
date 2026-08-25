import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../../lib/utils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { AgentDisclosure, SPRING_SWAP } from '../../../../shared/view/beui';
import { ToolRowStatusIcon, firstErrorLine } from './ToolRowStatus';
import type { ToolStatus } from './ToolRowStatus';

interface BashCommandDisplayProps {
  command: string;
  description?: string;
  /** Combined stdout/stderr from the tool result (empty while running). */
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  defaultOpen?: boolean;
  /** Formatted send time; sits at the right end of the description line. */
  timestamp?: string;
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
  timestamp,
}) => {
  const reduce = useReducedMotion() ?? false;
  const trimmedOutput = (output || '').replace(/\s+$/, '');
  const hasOutput = trimmedOutput.length > 0;
  const outputLineCount = hasOutput ? trimmedOutput.split('\n').length : 0;
  const isRunning = status === 'running';
  const errorLine = status === 'error' || status === 'denied' ? firstErrorLine(trimmedOutput) : '';
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const didCopy = await copyTextToClipboard(command);
    if (!didCopy) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/cmd my-0.5 w-full text-sm">
      {/* Command header — clickable when there is output to expand */}
      <div
        role={hasOutput ? 'button' : undefined}
        tabIndex={hasOutput ? 0 : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasOutput && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex min-h-7 items-center gap-2 rounded-md py-0.5 outline-none',
          hasOutput && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {/* Leading-icon status (ui12 job 10): the `$` glyph gives way to the
            ramped spinner while running and the red/amber status glyph on
            error/denial — same size-4 slot, no layout shift. */}
        <span className="grid size-4 shrink-0 select-none place-items-center font-mono text-xs font-semibold text-muted-foreground">
          {status ? <ToolRowStatusIcon status={status} /> : '$'}
        </span>
        {/* Not a <code> tag: the global `.chat-message code` rule forces
            `white-space: pre-wrap !important`, which would defeat `truncate`
            and render collapsed multi-line commands in full. */}
        <span
          className={cn(
            'min-w-0 flex-1 font-mono text-xs text-foreground/90',
            open ? 'whitespace-pre-wrap break-all' : 'truncate',
          )}
        >
          {command}
        </span>

        {!open && hasOutput && !isRunning && (
          <span className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {outputLineCount} {outputLineCount === 1 ? 'line' : 'lines'}
          </span>
        )}

        <button
          onClick={handleCopy}
          onKeyDown={(event) => event.stopPropagation()}
          className="touch:opacity-100 grid size-5 flex-shrink-0 place-items-center rounded text-muted-foreground/60 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground focus:opacity-100 group-hover/cmd:opacity-100"
          title="Copy command"
          aria-label="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>

        {/* Fixed chevron slot: every tool row ends in this size-4 slot so the
            chevrons share one right-edge column regardless of content. */}
        <span className="grid size-4 flex-shrink-0 place-items-center">
          {hasOutput && (
            <motion.span
              aria-hidden="true"
              animate={{ rotate: open ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="text-muted-foreground/50 transition-colors group-hover/cmd:text-muted-foreground"
            >
              <ChevronDown className="size-3.5" />
            </motion.span>
          )}
        </span>
      </div>

      {(errorLine || description) && !open && (
        <div className="flex items-center gap-2 pl-6 text-[11px] text-muted-foreground/70">
          {errorLine ? (
            <span className="min-w-0 truncate text-rose-600 dark:text-rose-400" title={errorLine}>{errorLine}</span>
          ) : (
            <span className="min-w-0 truncate italic">{description}</span>
          )}
          {timestamp && (
            <span className="touch:opacity-100 ml-auto flex-shrink-0 tabular-nums opacity-0 transition-opacity duration-200 group-hover/cmd:opacity-100">
              {timestamp}
            </span>
          )}
        </div>
      )}

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
