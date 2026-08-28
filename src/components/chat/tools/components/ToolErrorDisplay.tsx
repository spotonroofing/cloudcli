import React, { useState } from 'react';
import { CircleX } from 'lucide-react';

import { AgentDisclosure, TranscriptIndicatorRow } from '../../../../shared/view/beui';
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
      <TranscriptIndicatorRow
        kind="error"
        glyph={<CircleX className="size-3.5" />}
        leadingClassName="text-rose-600 dark:text-rose-400"
        label={label}
        detail={hasContent ? trimmedContent : undefined}
        expandable={hasContent}
        expanded={open}
        onToggle={toggle}
      />

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
