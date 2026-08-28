import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Globe, Search } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { TEXT_SHIMMER_KEYFRAMES } from './textShimmer';
import { TranscriptIndicatorRow } from './TranscriptIndicatorRow';
import { useFavicon } from './useFavicon';

/**
 * beautifului.dev Thinking (www.beautifului.dev), vendored from its public
 * source mirror and rethemed to this app's tokens: the expandable agent
 * trace with four modes — steps (step list, spinner on the active step,
 * muted checks on done ones), reasoning (prose that expands then settles),
 * search (query row plus the sources read), coding (tool rows with mono
 * targets and +/− counts). The donor's canned demo timeline is replaced by
 * live props (`working`, `rows`) driven by the real transcript: the trace
 * auto-opens while work is in flight, settles closed shortly after, and
 * stays manually expandable forever.
 */

export type ThinkingMode = 'steps' | 'reasoning' | 'search' | 'coding';

export type ThinkingRow = {
  key: string;
  primary: ReactNode;
  /** Right-aligned detail — a file name, domain, or count. */
  secondary?: ReactNode;
  /** Render `secondary` in the mono cut (file paths, commands). */
  mono?: boolean;
  /** Diff counts (coding mode). */
  add?: number;
  del?: number;
  /** Row links out (search mode sources). */
  href?: string;
  /** Source URL for the favicon tile (search mode). */
  faviconUrl?: string;
  /** Step state (steps mode): the active row spins, done rows check. */
  state?: 'active' | 'done';
  /** Error tint on the secondary slot. */
  isError?: boolean;
};

const AUTO_CLOSE_DELAY_MS = 1200;
const TRACE_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

function SourceFavicon({ url }: { url?: string }) {
  const { src, ref } = useFavicon(url);
  return (
    <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-sm">
      {src ? (
        <img ref={ref} src={src} alt="" className="size-3.5 rounded-[3px]" />
      ) : (
        <Globe aria-hidden="true" className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

function StepStateIcon({ state }: { state?: 'active' | 'done' }) {
  if (state === 'active') {
    return (
      <span
        aria-hidden="true"
        className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-muted-foreground"
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export interface ThinkingProps {
  mode: ThinkingMode;
  /** Transcript kind override for callers such as agents and memory writes. */
  kind?: string;
  /** True while the traced work is still in flight. */
  working?: boolean;
  /** Replaces the star glyph in the header's size-4 icon slot (size-3.5 glyph, caller-colored). */
  icon?: ReactNode;
  /** Shimmering header label while working. */
  activeLabel: string;
  /** Settled header label once done. */
  doneLabel: string;
  /** Muted detail beside the active label. */
  activeDetail?: ReactNode;
  /** Muted detail beside the settled label. */
  doneDetail?: ReactNode;
  /** Muted status metadata between the label and disclosure chevron. */
  meta?: ReactNode;
  /** Search mode: the query line above the source rows. */
  query?: string;
  /** Muted context block above the rows (a subagent's prompt excerpt). */
  intro?: ReactNode;
  rows?: ThinkingRow[];
  /** Reasoning mode prose (and any extra blocks) inside the trace. */
  children?: ReactNode;
  /** Extra content after the rows (a result excerpt, controls). */
  footer?: ReactNode;
  className?: string;
}

export function Thinking({
  mode,
  kind,
  working = false,
  icon,
  activeLabel,
  doneLabel,
  activeDetail,
  doneDetail,
  meta,
  query,
  intro,
  rows = [],
  children,
  footer,
  className,
}: ThinkingProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  // Auto behavior: open while working, close shortly after settling. A trace
  // that mounts already settled (loaded history) starts closed.
  const [autoExpanded, setAutoExpanded] = useState(working);
  const wasWorkingRef = useRef(working);
  useEffect(() => {
    if (working) {
      wasWorkingRef.current = true;
      setAutoExpanded(true);
      return;
    }
    if (!wasWorkingRef.current) return;
    const timer = setTimeout(() => setAutoExpanded(false), AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [working]);
  const expanded = manualExpanded ?? autoExpanded;

  // Rows already on hand at mount render statically; only rows arriving
  // afterwards fade up (the useStreamedReveal no-replay pattern).
  const initialRowCountRef = useRef<number | null>(null);
  if (initialRowCountRef.current === null) initialRowCountRef.current = rows.length;
  const animateFromIndex = initialRowCountRef.current;

  return (
    <div className={cn('not-prose flex w-full flex-col', className)} data-slot="thinking-trace" data-mode={mode}>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <TranscriptIndicatorRow
        kind={kind ?? mode}
        glyph={icon ?? (
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        label={working ? activeLabel : doneLabel}
        detail={working ? activeDetail : doneDetail}
        duration={meta}
        active={working}
        expandable
        expanded={expanded}
        onToggle={() => setManualExpanded((current) => !(current ?? autoExpanded))}
      />

      <div
        className="grid transition-[grid-template-rows,opacity] duration-[400ms]"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: TRACE_EASE,
        }}
      >
        <div className="overflow-hidden">
          {/* pl-6 indent, no left rule — the tool-row disclosure law. */}
          <div className="mt-1 pl-6">
            <div className="flex flex-col gap-1 py-1">
              {intro && (
                <div className="px-1.5 py-0.5 text-xs leading-relaxed text-muted-foreground/80">{intro}</div>
              )}
              {query && (
                <div className="flex min-h-6 items-center gap-2 px-1.5">
                  <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{query}</span>
                </div>
              )}
              {rows.map((row, index) => {
                const rowClass =
                  'flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left';
                const animation =
                  index >= animateFromIndex
                    ? { animation: `bui-fade-up 320ms ${TRACE_EASE} ${Math.min(index - animateFromIndex, 4) * 120}ms both` }
                    : undefined;

                const content = (
                  <>
                    {mode === 'search' && <SourceFavicon url={row.faviconUrl ?? row.href} />}
                    {mode === 'steps' && <StepStateIcon state={row.state} />}
                    <span className="min-w-0 truncate text-xs font-medium text-foreground">
                      {row.primary}
                    </span>
                    {row.secondary !== undefined && (
                      <span
                        className={cn(
                          'shrink-0 text-[11px]',
                          row.isError ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/70',
                          row.mono && 'font-mono',
                        )}
                      >
                        {row.secondary}
                      </span>
                    )}
                    {row.add !== undefined && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        <span className="text-emerald-600 dark:text-emerald-400">+{row.add}</span>{' '}
                        <span className="text-rose-600 dark:text-rose-400">−{row.del ?? 0}</span>
                      </span>
                    )}
                  </>
                );

                if (row.href) {
                  return (
                    <a
                      key={row.key}
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`${rowClass} transition-colors duration-150 hover:bg-muted/60`}
                      style={animation}
                    >
                      {content}
                    </a>
                  );
                }

                return (
                  <div key={row.key} className={rowClass} style={animation}>
                    {content}
                  </div>
                );
              })}
              {children && (
                <div className="px-1.5 py-0.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
              )}
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
