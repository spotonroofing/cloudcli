import React, { useState } from 'react';
import { ChevronDown, CircleX } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../../lib/utils';
import { AgentDisclosure, SPRING_SWAP } from '../../../../shared/view/beui';
import { Markdown } from '../../view/subcomponents/Markdown';

interface ToolErrorDisplayProps {
  /** Full error text; rendered as markdown when expanded. */
  content: string;
  /** Localized "Error" label shown in the header. */
  label: string;
}

/**
 * Collapsed-by-default error row for non-Bash tool results in the beUI
 * tool-result error treatment (rose status colorway, spring chevron,
 * AgentDisclosure reveal into a rounded muted viewport). The details stay
 * one click away.
 */
export const ToolErrorDisplay: React.FC<ToolErrorDisplayProps> = ({ content, label }) => {
  const reduce = useReducedMotion() ?? false;
  const trimmedContent = content.trim();
  const hasContent = trimmedContent.length > 0;
  const [open, setOpen] = useState(false);

  const toggle = () => {
    if (hasContent) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div className="my-0.5 w-full text-sm">
      <div
        role={hasContent ? 'button' : undefined}
        tabIndex={hasContent ? 0 : undefined}
        aria-expanded={hasContent ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasContent && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex min-h-7 items-center gap-2 rounded-md py-0.5 outline-none',
          hasContent && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          <CircleX className="size-3" />
          {label}
        </span>
        {!open && hasContent && (
          /* Not a <code>/<pre> tag: the global `.chat-message code` rule forces
             `white-space: pre-wrap !important`, which would defeat `truncate`. */
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {trimmedContent}
          </span>
        )}
        {hasContent && (
          <motion.span
            aria-hidden="true"
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="ml-auto shrink-0 text-muted-foreground/50"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        )}
      </div>

      <AgentDisclosure open={open && hasContent}>
        <div className="pl-6 pt-1.5">
          <div className="overflow-hidden rounded-lg bg-muted/80 p-3 text-sm">
            <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
              {trimmedContent}
            </Markdown>
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
};
