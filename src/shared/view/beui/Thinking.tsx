import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Globe, Search } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../../../lib/utils';

import { SPRING_SWAP } from './ease';
import { TEXT_SHIMMER_CLASS_NAME, TEXT_SHIMMER_KEYFRAMES, textShimmerStyle } from './textShimmer';
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
  /** True while the traced work is still in flight. */
  working?: boolean;
  /** Replaces the star glyph in the header's size-4 icon slot (size-3.5 glyph, caller-colored). */
  icon?: ReactNode;
  /** Shimmering header label while working. */
  activeLabel: string;
  /** Settled header label once done. */
  doneLabel: string;
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
  working = false,
  icon,
  activeLabel,
  doneLabel,
  query,
  intro,
  rows = [],
  children,
  footer,
  className,
}: ThinkingProps) {
  const reduceMotion = useReducedMotion() ?? false;
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
      {/* Header in the shared row anatomy (ui13 job 13, Bash reference):
          size-4 leading icon slot, text-xs medium label, spring-rotated
          size-3.5 chevron in a size-4 slot, min-h-7 rhythm. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? autoExpanded))}
        className="-mx-1.5 flex min-h-7 w-fit items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors duration-100 hover:bg-muted/60"
      >
        <span className="grid size-4 shrink-0 place-items-center">
          {icon ?? (
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              className={working ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-muted-foreground/60'}
            >
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
            </svg>
          )}
        </span>
        {working ? (
          <span
            className={`whitespace-nowrap text-xs font-medium ${TEXT_SHIMMER_CLASS_NAME}`}
            style={textShimmerStyle(1.4)}
          >
            {activeLabel}
          </span>
        ) : (
          <span
            className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            style={{ animation: 'bui-fade-in 350ms ease-out both' }}
          >
            {doneLabel}
          </span>
        )}
        <span className="grid size-4 shrink-0 place-items-center">
          <motion.span
            aria-hidden="true"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
            className="text-muted-foreground/50"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </span>
      </button>

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
