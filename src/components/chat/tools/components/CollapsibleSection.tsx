import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../../lib/utils';
import { AgentDisclosure, SPRING_SWAP } from '../../../../shared/view/beui';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Tool-row disclosure in the beUI tool-result treatment (beui.dev/components/
 * agents/tool-result): a min-height header row — tool name, mono title, badge —
 * with a spring-rotated chevron on the right, revealing the content through
 * AgentDisclosure with a left indent. When there's a clickable title
 * (Edit/Write), only the row toggles and the title opens the file.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  badge,
  onTitleClick,
  children,
  className = '',
}) => {
  const reduce = useReducedMotion() ?? false;
  const [isOpen, setIsOpen] = useState(open);

  const chevron = (
    <motion.span
      aria-hidden="true"
      animate={{ rotate: isOpen ? 180 : 0 }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="ml-auto shrink-0 text-muted-foreground/50 transition-colors group-hover/section:text-muted-foreground"
    >
      <ChevronDown className="size-3.5" />
    </motion.span>
  );

  return (
    <div className={cn('w-full text-sm', className)}>
      {onTitleClick ? (
        <div className="group/section flex min-h-7 w-full select-none items-center gap-2 py-0.5 text-xs">
          {toolName && (
            <span className="shrink-0 font-medium text-foreground/90">{toolName}</span>
          )}
          <button
            onClick={onTitleClick}
            className="min-w-0 truncate text-left font-mono text-[11px] text-primary transition-colors hover:text-primary/80 hover:underline"
            title={title}
          >
            {title}
          </button>
          {badge && <span className="shrink-0">{badge}</span>}
          {action && <span className="shrink-0">{action}</span>}
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((current) => !current)}
            className="ml-auto flex shrink-0 items-center rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
          className="group/section flex min-h-7 w-full select-none items-center gap-2 rounded-md py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {toolName && (
            <span className="shrink-0 font-medium text-foreground/90">{toolName}</span>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">{title}</span>
          {badge && <span className="shrink-0">{badge}</span>}
          {action && <span className="shrink-0">{action}</span>}
          {chevron}
        </button>
      )}

      <AgentDisclosure open={isOpen}>
        <div className="mt-1.5 pl-6">
          {children}
        </div>
      </AgentDisclosure>
    </div>
  );
};
