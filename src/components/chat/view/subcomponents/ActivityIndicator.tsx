import { useEffect, useState } from 'react';

import {
  PixelLoader,
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
} from '../../../../shared/view/beui';
import type { PixelLoaderVariant } from '../../../../shared/view/beui';
import { NumberTicker } from '../../../../shared/view/beui/NumberTicker';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
};

const SHIMMER_DURATION_S = 1.4;
const PHASE_PRESENTATION: Record<'thinking' | 'writing', { word: string; variant: PixelLoaderVariant }> = {
  thinking: { word: 'Thinking', variant: 'drive' },
  writing: { word: 'Writing', variant: 'dots' },
};

/**
 * Inline response-in-progress indicator, rendered in the message flow where
 * the reply will appear: the beautifului.dev Loading State — pixel-grid
 * loader left of the real current phase plus its phase-local elapsed counter.
 * Tool phases render no generic row because the tool row itself owns the live
 * status and counter. Interrupting lives on the composer's send/stop button.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const startedAt = activity?.phaseStartedAt ?? null;
  const [elapsedDeciseconds, setElapsedDeciseconds] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedDeciseconds(Math.max(0, Math.floor((Date.now() - startedAt) / 100)));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!activity || activity.phase === 'tool') return null;

  const presentation = PHASE_PRESENTATION[activity.phase];
  const label = presentation.word;

  const totalSeconds = elapsedDeciseconds / 10;
  const elapsedLabel = totalSeconds < 60
    ? `${totalSeconds.toFixed(1)}s`
    : `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`;

  return (
    <div className="chat-activity-enter" data-phase={activity.phase}>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <div className="flex items-center gap-2.5 text-sm" role="status" data-testid="activity-indicator">
        <PixelLoader variant={presentation.variant} className="shrink-0" />
        <span className="sr-only">{label}</span>
        <span
          key={label}
          aria-hidden="true"
          className={`text-[13px] font-medium ${TEXT_SHIMMER_CLASS_NAME}`}
          style={{ animation: `beui-text-shimmer ${SHIMMER_DURATION_S}s linear infinite, bui-fade-in 350ms ease-out both` }}
        >
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground/60">
          {/* Ticker layout (fixed glyph boxes, place-keyed digits) but zero
              roll: the tenths digit updates every 100ms, faster than any roll
              can settle, so a rolling column here is perpetually mid-glyph
              and reads as digits at different heights. */}
          <NumberTicker
            value={elapsedDeciseconds}
            format={() => elapsedLabel}
            duration={0}
            stagger={0}
            startOnView={false}
          />
        </span>
      </div>
    </div>
  );
}
