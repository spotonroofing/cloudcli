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
 * Reveal `text` progressively from mount at `charactersPerSecond`, never
 * outrunning what has actually arrived. Commits are capped at ~30fps — the
 * revealed slice feeds a markdown renderer, so per-frame reparses would cost
 * more than they show.
 */
export function useStreamedReveal(text: string, charactersPerSecond = CHARACTERS_PER_SECOND) {
  // Text already on hand at mount shows immediately — a pane opened mid-turn
  // must not replay the whole buffer; only text arriving after mount plays back.
  const initialLengthRef = useRef<number | null>(null);
  if (initialLengthRef.current === null) initialLengthRef.current = text.length;
  const [cursor, setCursor] = useState(initialLengthRef.current);
  const startedAtRef = useRef<number | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    let rafId = 0;
    let lastCommit = 0;

    const tick = (now: number) => {
      if (startedAtRef.current === null) startedAtRef.current = now;
      const target = (initialLengthRef.current ?? 0)
        + Math.floor(((now - startedAtRef.current) / 1000) * charactersPerSecond);
      const next = Math.min(target, textRef.current.length);
      if (now - lastCommit >= 33) {
        lastCommit = now;
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
