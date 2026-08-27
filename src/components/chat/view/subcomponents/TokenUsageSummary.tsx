import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { NumberTicker } from '../../../../shared/view/beui/NumberTicker';

type UsageCategory = {
  name: string;
  tokens: number;
  color?: string;
  isDeferred?: boolean;
};

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
};

type CodexUsageRow = {
  key: string;
  label: string;
  tokens: number;
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** "98.3k" under 100k, "200k" up to 1M, "1M"/"1.5M" above, plain numbers under 1000. */
const formatTokensShort = (tokens: number) => {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens >= 1000000) {
    const millions = tokens / 1000000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
  }
  const thousands = tokens / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
};

/** SDK category color names → theme dot classes; free space stays neutral. */
const CATEGORY_DOT_CLASSES: Record<string, string> = {
  claude: 'bg-primary',
  warning: 'bg-amber-500',
  inactive: 'bg-muted-foreground/40',
  promptBorder: 'bg-emerald-500',
  purple_FOR_SUBAGENTS_ONLY: 'bg-violet-500',
};

const categoryDotClass = (category: UsageCategory) => {
  if (category.name === 'Free space') {
    return 'bg-border';
  }
  return CATEGORY_DOT_CLASSES[category.color ?? ''] ?? 'bg-muted-foreground/40';
};

/**
 * Claude-desktop-style context meter: a small circular progress ring showing
 * the percent of the context window used. Clicking it opens the usage popover
 * with a "Context window" header row and, when the SDK has reported one, the
 * per-category breakdown of the live session's context.
 */
export default function TokenUsageSummary({ usage }: TokenUsageSummaryProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  // The popover opens to the left (ui13 job 12): its right edge aligns with
  // the ring button's right edge so it grows leftward, staying inside the
  // pane; the anchor hook shrinks maxWidth on narrow viewports.
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(
    isOpen,
    close,
    320,
  );

  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const totalTokens = readUsageNumber(usage?.total);
  const isCodex = usage?.provider === 'codex';
  const hasCodexReading = isCodex && usage?.readingAvailable === true;
  const codexRows: CodexUsageRow[] = hasCodexReading
    ? [
      {
        key: 'cached-input',
        label: t('composer.contextCachedInput', { defaultValue: 'Input from cache' }),
        tokens: readUsageNumber(usage?.cachedInputTokens),
      },
      {
        key: 'fresh-input',
        label: t('composer.contextFreshInput', { defaultValue: 'Fresh input' }),
        tokens: readUsageNumber(usage?.freshInputTokens),
      },
      {
        key: 'output',
        label: t('composer.contextOutput', { defaultValue: 'Output' }),
        tokens: outputTokens,
      },
      {
        key: 'reasoning',
        label: t('composer.contextReasoning', { defaultValue: 'Reasoning' }),
        tokens: readUsageNumber(usage?.reasoningTokens),
      },
      {
        key: 'window',
        label: t('composer.contextWindow', { defaultValue: 'Context window' }),
        tokens: totalTokens,
      },
    ]
    : [];
  const percentUsed = totalTokens > 0
    ? Math.min(100, Math.round((usedTokens / totalTokens) * 100))
    : 0;
  const totalIsUsableWindow = usage?.totalIsUsableWindow === true;
  const categories = (Array.isArray(usage?.categories) ? usage.categories : [])
    .map((category) => ({
      name: String((category as UsageCategory).name ?? ''),
      tokens: readUsageNumber((category as UsageCategory).tokens),
      color: (category as UsageCategory).color,
      isDeferred: Boolean((category as UsageCategory).isDeferred),
    }))
    .filter((category) => category.name && category.tokens > 0);

  const noReadingLabel = t('composer.contextNoReading', { defaultValue: 'No reading yet' });
  const headerValue = isCodex && !hasCodexReading
    ? noReadingLabel
    : totalTokens > 0
      ? `${formatTokensShort(usedTokens)} / ${formatTokensShort(totalTokens)} (${percentUsed}%)`
      : formatTokensShort(usedTokens);

  const ariaLabel = t('composer.contextUsage', { defaultValue: 'Show context window usage' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="touch-hit relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        title={isCodex && !hasCodexReading
          ? noReadingLabel
          : `${percentUsed}% of context used (${usedTokens.toLocaleString()} tokens)`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-context-percent={percentUsed}
      >
        <svg viewBox="0 0 18 18" className="h-4 w-4 -rotate-90" aria-hidden="true">
          {/* Unused track: muted-foreground ink, not the border token — the
              hover bg-accent fill is the same value as border, which made the
              track vanish under hover. */}
          <circle
            cx="9"
            cy="9"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            className="stroke-muted-foreground/30"
          />
          <circle
            cx="9"
            cy="9"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - percentUsed / 100)}
            className="stroke-primary transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      </button>

      {isOpen && anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          data-usage-popover
          className="popout-enter popout-enter-up fixed z-[100] w-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{
            left: anchor.left,
            right: anchor.right,
            bottom: anchor.bottom,
            maxHeight: anchor.maxHeight,
            maxWidth: anchor.maxWidth,
          }}
        >
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {t('composer.contextWindow', { defaultValue: 'Context window' })}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground" data-usage-header-value>
              {/* Digits roll (beUI NumberTicker); the k/M/% glyphs render as plain text, so "70k / 1M (45%)" reads exactly as before. */}
              <NumberTicker
                value={usedTokens}
                format={() => headerValue}
                duration={0.35}
                stagger={0}
                startOnView={false}
              />
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {totalIsUsableWindow && (
            <p className="px-2.5 pb-1 text-[11px] leading-4 text-muted-foreground">
              {t('composer.contextUsableWindow', {
                defaultValue: 'Limit shown is the usable window before auto-compact.',
              })}
            </p>
          )}

          {isExpanded && (
            isCodex ? (
              hasCodexReading ? (
                <div className="px-1 pb-1" data-codex-usage-breakdown>
                  {codexRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs"
                      data-codex-usage-field={row.key}
                      data-token-count={row.tokens}
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground/90">{row.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.tokens.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2.5 pb-2 text-xs leading-4 text-muted-foreground">
                  {noReadingLabel}
                </p>
              )
            ) : categories.length > 0 ? (
              <div className="px-1 pb-1">
                {categories.map((category) => {
                  const categoryPercent = totalTokens > 0
                    ? Math.round((category.tokens / totalTokens) * 100)
                    : 0;
                  return (
                    <div
                      key={category.name}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${categoryDotClass(category)}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground/90">{category.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatTokensShort(category.tokens)}
                        {' · '}
                        {categoryPercent < 1 ? '<1%' : `${categoryPercent}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-2.5 pb-2 text-xs leading-4 text-muted-foreground">
                {t('composer.contextBreakdownPending', {
                  defaultValue: 'Breakdown appears after the next response.',
                })}
              </p>
            )
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
