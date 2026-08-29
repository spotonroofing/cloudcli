import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

import {
  PixelLoader,
  TranscriptIndicatorRow,
} from '../../../../shared/view/beui';
import { NumberTicker } from '../../../../shared/view/beui/NumberTicker';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import { useSharedNow } from '../../../../hooks/useSharedNow';

import {
  ACTIVITY_PRESENTATIONS,
  ACTIVITY_ROTATION_MS,
  ACTIVITY_SWAP_MS,
  pickNextPresentationIndex,
} from './activityPresentation';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
};

function normalizeStatusWord(statusText: string | null | undefined): string | null {
  const normalized = statusText?.trim().replace(/[.…]+$/u, '').trim();
  return normalized || null;
}

/**
 * Inline response-in-progress indicator, rendered in the message flow where
 * the reply will appear: the beautifului.dev Loading State — pixel-grid
 * loader left of a rotating Claude-style status word plus its phase-local
 * elapsed counter. Each word owns one pattern, and a single DOM loader fades
 * out before its word/pattern pair changes and fades back in.
 * Tool phases render no generic row because the tool row itself owns the live
 * status and counter. Interrupting lives on the composer's send/stop button.
 */
export default function ActivityIndicator({ activity }: ActivityIndicatorProps) {
  const startedAt = activity?.phaseStartedAt ?? null;
  const now = useSharedNow(startedAt !== null, 100);
  const reduceMotion = useReducedMotion() ?? false;
  const reduceMotionRef = useRef(reduceMotion);
  const recentIndicesRef = useRef<number[]>([0]);
  const lastStatusTextRef = useRef<string | null | undefined>(activity?.statusText);
  const currentStatusTextRef = useRef<string | null | undefined>(activity?.statusText);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const [overrideWord, setOverrideWord] = useState(() => normalizeStatusWord(activity?.statusText));
  const [swapVisible, setSwapVisible] = useState(true);
  currentStatusTextRef.current = activity?.statusText;

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    const runStartedAt = activity?.startedAt ?? null;
    recentIndicesRef.current = [0];
    setPresentationIndex(0);
    setOverrideWord(normalizeStatusWord(currentStatusTextRef.current));
    setSwapVisible(true);

    if (runStartedAt === null) return;

    let swapTimer: number | null = null;
    const rotate = () => {
      const nextIndex = pickNextPresentationIndex(recentIndicesRef.current);

      const commit = () => {
        recentIndicesRef.current = [...recentIndicesRef.current, nextIndex].slice(-2);
        setPresentationIndex(nextIndex);
        setOverrideWord(null);
        setSwapVisible(true);
      };

      if (reduceMotionRef.current) {
        commit();
        return;
      }

      setSwapVisible(false);
      swapTimer = window.setTimeout(commit, ACTIVITY_SWAP_MS);
    };

    const rotationTimer = window.setInterval(rotate, ACTIVITY_ROTATION_MS);
    return () => {
      window.clearInterval(rotationTimer);
      if (swapTimer !== null) window.clearTimeout(swapTimer);
    };
  }, [activity?.startedAt]);

  useEffect(() => {
    const statusText = activity?.statusText;
    if (statusText === lastStatusTextRef.current) return;
    lastStatusTextRef.current = statusText;

    const normalized = normalizeStatusWord(statusText);
    if (normalized) setOverrideWord(normalized);
  }, [activity?.statusText]);

  if (!activity || activity.phase === 'tool') return null;

  const presentation = ACTIVITY_PRESENTATIONS[presentationIndex];
  const label = overrideWord ?? presentation.word;
  const swapStyle = { opacity: swapVisible ? 1 : 0 };

  const elapsedDeciseconds = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 100));
  const totalSeconds = elapsedDeciseconds / 10;
  const elapsedLabel = totalSeconds < 60
    ? `${totalSeconds.toFixed(1)}s`
    : `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`;

  return (
    <div
      className="chat-activity-enter my-0.5"
      data-phase={activity.phase}
      data-presentation={presentation.word}
      data-pattern={presentation.variant}
    >
      <TranscriptIndicatorRow
        kind={`activity-${activity.phase}`}
        role="status"
        testId="activity-indicator"
        glyph={(
          <span className="bui-pixel-swap" data-slot="activity-grid-swap" style={swapStyle}>
            <PixelLoader variant={presentation.variant} />
          </span>
        )}
        label={(
          <span
            className="bui-pixel-swap"
            data-slot="activity-word-swap"
            data-catalog-word={presentation.word}
            data-server-override={overrideWord ? 'true' : undefined}
            style={swapStyle}
          >
            {label}
          </span>
        )}
        active
        duration={(
          <span
            data-slot="status-duration"
            data-state="running"
            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60"
          >
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
        )}
      />
    </div>
  );
}
