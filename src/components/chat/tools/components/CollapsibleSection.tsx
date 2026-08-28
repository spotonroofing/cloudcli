import React, { useState } from 'react';

import { cn } from '../../../../lib/utils';
import { AgentDisclosure, TranscriptIndicatorRow } from '../../../../shared/view/beui';

import { ToolGlyph } from './ToolGlyph';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  /** Leading status icon (ui12 job 10): ramped spinner / error glyph at row start. */
  statusIcon?: React.ReactNode;
  durationMeta?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Tool-row disclosure in the beUI tool-result treatment (beui.dev/components/
 * agents/tool-result): a min-height header row — leading status slot, tool
 * name, mono title — with a spring-rotated chevron on the right, revealing the
 * content through AgentDisclosure with a left indent. The whole row toggles
 * (Bash reference anatomy, ui13 job 13); a clickable title (Edit/Write) opens
 * the file without toggling.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  statusIcon,
  durationMeta,
  onTitleClick,
  children,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(open);

  return (
    <div className={cn('w-full text-sm', className)}>
      <TranscriptIndicatorRow
        kind={(toolName || 'tool').toLowerCase()}
        glyph={statusIcon || <ToolGlyph toolName={toolName || 'Tool'} />}
        label={toolName || 'Tool'}
        detail={title}
        meta={action}
        duration={durationMeta}
        expandable
        expanded={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
        onDetailClick={onTitleClick}
      />

      <AgentDisclosure open={isOpen}>
        <div className="mt-1.5 pl-6">
          {children}
        </div>
      </AgentDisclosure>
    </div>
  );
};
