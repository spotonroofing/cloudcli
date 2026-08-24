import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../../lib/utils';

/**
 * beUI streaming-response (beui.dev/components/agents/streaming-response),
 * vendored as the live-turn response surface: the `data-state`/`aria-busy`
 * wrapper and the demo's reveal engine — a requestAnimationFrame cursor that
 * uncovers arrived text at a fixed characters-per-second rate, so bursty
 * socket chunks read as one continuous stream. The donor's completion action
 * row (copy/retry/feedback/sources) was not vendored — this app's transcript
 * already owns copy and speak controls per message.
 *
 * The donor demo reveals at 110 characters per second; this app plays back
 * roughly 15% faster.
 */
export const CHARACTERS_PER_SECOND = 126;

/**
 * Backlog beyond this cushion drains at a catch-up rate proportional to its
 * size, so playback never falls behind real arrival: a burst of chunks reads
 * as a fast stream, not a lag that snaps whole at turn end.
 */
const CATCHUP_LAG_CHARS = 180;
const CATCHUP_DRAIN_PER_SECOND = 3;
/** An unbroken token longer than this reveals raw instead of holding for a boundary. */
const MAX_HELD_WORD_CHARS = 24;

/**
 * Reveal `text` progressively from mount, never outrunning what has actually
 * arrived. The cursor advances in word steps (the beautifului streaming-text
 * cadence — words land whole and blur in, instead of characters trickling),
 * at `charactersPerSecond` plus a backlog-proportional catch-up. Commits are
 * capped at ~30fps — the revealed slice feeds a markdown renderer, so
 * per-frame reparses would cost more than they show.
 */
export function useStreamedReveal(text: string, charactersPerSecond = CHARACTERS_PER_SECOND) {
  // Text already on hand at mount shows immediately — a pane opened mid-turn
  // must not replay the whole buffer; only text arriving after mount plays back.
  const initialLengthRef = useRef<number | null>(null);
  if (initialLengthRef.current === null) initialLengthRef.current = text.length;
  const [cursor, setCursor] = useState(initialLengthRef.current);
  const cursorRef = useRef(initialLengthRef.current);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    let rafId = 0;
    let lastTime: number | null = null;
    let lastCommit = 0;
    let fractional = 0;

    const tick = (now: number) => {
      if (lastTime === null) lastTime = now;
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const full = textRef.current;
      const backlog = full.length - cursorRef.current;
      if (backlog > 0) {
        const rate = charactersPerSecond
          + Math.max(0, backlog - CATCHUP_LAG_CHARS) * CATCHUP_DRAIN_PER_SECOND;
        fractional = Math.min(fractional + dt * rate, backlog);
        const step = Math.floor(fractional);
        if (step > 0) {
          let next = Math.min(full.length, cursorRef.current + step);
          if (next < full.length) {
            // Snap down to a word boundary so words land whole; hold a short
            // in-flight word until its boundary arrives.
            const boundary = Math.max(full.lastIndexOf(' ', next), full.lastIndexOf('\n', next));
            if (boundary >= cursorRef.current) next = boundary + 1;
            else if (next - cursorRef.current < MAX_HELD_WORD_CHARS) next = cursorRef.current;
          }
          if (next > cursorRef.current) {
            fractional -= next - cursorRef.current;
            cursorRef.current = next;
          }
        }
      }

      if (now - lastCommit >= 33) {
        lastCommit = now;
        const next = cursorRef.current;
        setCursor((current) => (next > current ? next : current));
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [charactersPerSecond]);

  return Math.min(cursor, text.length);
}

export interface StreamingResponseProps {
  /** Rendered response content. Pass plain text or the output of a Markdown renderer. */
  children: ReactNode;
  status?: 'streaming' | 'complete' | 'error';
  /** Set false when a surrounding conversation log announces streamed text. */
  announce?: boolean;
  className?: string;
  contentClassName?: string;
}

export function StreamingResponse({
  children,
  status = 'streaming',
  announce = true,
  className,
  contentClassName,
}: StreamingResponseProps) {
  const streaming = status === 'streaming';

  return (
    <div data-state={status} aria-busy={streaming} className={cn('w-full', className)}>
      <div aria-live={announce ? 'polite' : 'off'} className={contentClassName}>
        {children}
      </div>
    </div>
  );
}
