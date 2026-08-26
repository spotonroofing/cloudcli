import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../../lib/utils';
import { AgentDisclosure, CitationList, SPRING_SWAP } from '../../../../shared/view/beui';
import type { CitationItem } from '../../../../shared/view/beui';

import { ToolRowStatusIcon, firstErrorLine } from './ToolRowStatus';

interface ResearchDisplayProps {
  /** 'WebFetch' reads one page; anything else is a search-style tool. */
  toolName: string;
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
}

const parseInputObject = (toolInput: unknown): Record<string, any> => {
  if (typeof toolInput !== 'string') return (toolInput as Record<string, any>) || {};
  try {
    return JSON.parse(toolInput);
  } catch {
    return {};
  }
};

const domainOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Research row (ui12 job 10): web search and fetch tool calls render in the
 * standard tool-row anatomy — "Research" label, the query or domain as the
 * mono description, collapsed by default — expanding to the sources the tool
 * result actually carried (title + URL favicon rows, opening in a new tab).
 * Sources are never synthesized: no result, no rows.
 */
export const ResearchDisplay: React.FC<ResearchDisplayProps> = ({ toolName, toolInput, toolResult }) => {
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const isFetch = toolName === 'WebFetch';
  const input = useMemo(() => parseInputObject(toolInput), [toolInput]);
  const running = !toolResult;
  const failed = Boolean(toolResult?.isError);
  const url = String(input.url || '');
  const query = isFetch ? (domainOf(url) || url) : String(input.query || '');
  const errorLine = failed ? firstErrorLine(toolResult?.content) : '';

  const sources = useMemo((): CitationItem[] => {
    if (running || failed) return [];
    if (isFetch) {
      const domain = domainOf(url);
      if (!domain) return [];
      return [{ id: url, title: domain, domain: url, url }];
    }
    // WebSearch results carry their links as a `Links: [...]` JSON block.
    const content = String(toolResult?.content || '');
    const linksMatch = /Links:\s*(\[[\s\S]*?\])\s*(?:\n|$)/.exec(content);
    if (!linksMatch) return [];
    try {
      const links = JSON.parse(linksMatch[1]) as Array<{ title?: string; url?: string }>;
      return links
        .filter((link) => typeof link.url === 'string' && domainOf(link.url))
        .map((link) => ({
          id: link.url as string,
          title: link.title || domainOf(link.url as string),
          domain: domainOf(link.url as string),
          url: link.url,
        }));
    } catch {
      return [];
    }
  }, [running, failed, isFetch, url, toolResult]);

  const expandable = sources.length > 0;

  const toggle = () => {
    if (expandable) setOpen((prev) => !prev);
  };

  return (
    <div data-slot="research-row" className="my-0.5 w-full text-sm">
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (expandable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'group/research flex min-h-7 items-center gap-2 rounded-md py-0.5 text-xs outline-none',
          expandable && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {(running || failed) && <ToolRowStatusIcon status={running ? 'running' : 'error'} />}
        <span className="shrink-0 font-medium text-foreground/90">Research</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {query}
        </span>
        {failed && errorLine && (
          <span
            className="min-w-0 max-w-[50%] truncate text-[11px] text-rose-600 dark:text-rose-400"
          >
            {errorLine}
          </span>
        )}
        {!open && expandable && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </span>
        )}
        {/* Fixed size-4 chevron slot per the shared tool-row right-edge column. */}
        <span className="grid size-4 shrink-0 place-items-center">
          {expandable && (
            <motion.span
              aria-hidden="true"
              animate={{ rotate: open ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="text-muted-foreground/50 transition-colors group-hover/research:text-muted-foreground"
            >
              <ChevronDown className="size-3.5" />
            </motion.span>
          )}
        </span>
      </div>

      <AgentDisclosure open={open && expandable}>
        <div className="mt-1.5 pl-6">
          <CitationList citations={sources} />
        </div>
      </AgentDisclosure>
    </div>
  );
};
