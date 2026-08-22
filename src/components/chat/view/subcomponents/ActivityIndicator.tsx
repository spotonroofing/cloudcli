import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BrailleLoader,
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from '../../../../shared/view/beui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
};

const EXIT_ANIMATION_MS = 220;
const SHIMMER_DURATION_S = 1.8;

/**
 * Inline response-in-progress indicator, rendered in the message flow where
 * the reply will appear: the horizontal beUI ASCII Braille loader sitting
 * left of a shimmering "thinking" label (server status text overrides the
 * word), plus the elapsed time. Rendered only while the viewed session has
 * an entry in the processing map; it fades out the moment that entry is
 * removed. Interrupting lives on the composer's send/stop button.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const label = (
    renderedActivity.statusText
    || t('claudeStatus.actions.thinking', { defaultValue: 'Thinking' })
  ).replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });

  return (
    <div className={isExiting ? 'chat-activity-exit' : 'chat-activity-enter'}>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <div className="flex items-center gap-2 text-sm" role="status" data-testid="activity-indicator">
        <BrailleLoader className="shrink-0 text-muted-foreground" label={label} />
        <span
          aria-hidden="true"
          className={`font-medium ${TEXT_SHIMMER_CLASS_NAME}`}
          style={textShimmerStyle(SHIMMER_DURATION_S)}
        >
          {`${label}…`}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground/60">{elapsedLabel}</span>
      </div>
    </div>
  );
}
