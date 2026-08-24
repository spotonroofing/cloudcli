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

const EXIT_ANIMATION_MS = 220;
const SHIMMER_DURATION_S = 1.4;
/** How long each status word (and its bound loader animation) holds before rotating. */
const ROTATION_HOLD_DS = 65;

/**
 * Each status word is bound to one of the three beautifului pixel-grid loader
 * animations; the pair rotates together while the turn stays in flight.
 */
const STATUS_ROTATION: Array<{ word: string; variant: PixelLoaderVariant }> = [
  { word: 'Thinking', variant: 'drive' },
  { word: 'Working', variant: 'dots' },
  { word: 'Churning', variant: 'orbit' },
];

/**
 * Inline response-in-progress indicator, rendered in the message flow where
 * the reply will appear: the beautifului.dev Loading State — pixel-grid
 * loader left of a shimmering status word, plus a live elapsed counter in
 * mono tabular figures. The word and its loader animation rotate together
 * with activity; a server status line overrides the word. Rendered only while
 * the viewed session has an entry in the processing map; it fades out the
 * moment that entry is removed. Interrupting lives on the composer's
 * send/stop button.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedDeciseconds, setElapsedDeciseconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedDeciseconds(Math.max(0, Math.floor((Date.now() - startedAt) / 100)));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const rotation = STATUS_ROTATION[Math.floor(elapsedDeciseconds / ROTATION_HOLD_DS) % STATUS_ROTATION.length];
  const label = (renderedActivity.statusText || rotation.word).replace(/\.+$/, '');

  const totalSeconds = elapsedDeciseconds / 10;
  const elapsedLabel = totalSeconds < 60
    ? `${totalSeconds.toFixed(1)}s`
    : `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`;

  return (
    <div className={isExiting ? 'chat-activity-exit' : 'chat-activity-enter'}>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <div className="flex items-center gap-2.5 text-sm" role="status" data-testid="activity-indicator">
        <PixelLoader variant={rotation.variant} className="shrink-0" />
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
          {/* Digits roll (beUI NumberTicker); the unit glyphs render as plain text, so the label reads exactly as the static string. */}
          <NumberTicker
            value={elapsedDeciseconds}
            format={() => elapsedLabel}
            duration={0.2}
            stagger={0}
            startOnView={false}
          />
        </span>
      </div>
    </div>
  );
}
