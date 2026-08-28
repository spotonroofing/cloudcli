import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { AgentDisclosure, CitationList, TranscriptIndicatorRow } from '../../../../shared/view/beui';
import type { CitationItem } from '../../../../shared/view/beui';
import StatusDuration from '../../view/subcomponents/StatusDuration';

import { ToolRowStatusIcon, firstErrorLine } from './ToolRowStatus';

interface ResearchDisplayProps {
  /** 'WebFetch' reads one page; anything else is a search-style tool. */
  toolName: string;
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  startedAt?: string | number | Date;
  durationMs?: number;
  running?: boolean;
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
export const ResearchDisplay: React.FC<ResearchDisplayProps> = ({
  toolName,
  toolInput,
  toolResult,
  startedAt,
  durationMs,
  running: runningOverride,
}) => {
  const [open, setOpen] = useState(false);
  const isFetch = toolName === 'WebFetch';
  const input = useMemo(() => parseInputObject(toolInput), [toolInput]);
  const running = runningOverride ?? !toolResult;
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
      <TranscriptIndicatorRow
        kind="research"
        glyph={(running || failed)
          ? <ToolRowStatusIcon status={running ? 'running' : 'error'} />
          : <Search className="size-3.5" />}
        label="Research"
        detail={failed && errorLine ? errorLine : query}
        meta={!open && expandable
          ? `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`
          : undefined}
        duration={<StatusDuration startedAt={startedAt} durationMs={durationMs} running={running} />}
        expandable={expandable}
        expanded={open}
        onToggle={toggle}
      />

      <AgentDisclosure open={open && expandable}>
        <div className="mt-1.5 pl-6">
          <CitationList citations={sources} />
        </div>
      </AgentDisclosure>
    </div>
  );
};
