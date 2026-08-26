import { useReducedMotion } from 'motion/react';
import {
  type ComponentPropsWithRef,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { cn } from '../../../lib/utils';

/**
 * beUI message-scroller (beui.dev/components/agents/message-scroller),
 * vendored with the follow-output engine intact: a ResizeObserver on the
 * content keeps the viewport pinned to the live edge while the reader is
 * within `followThreshold` of the end, smooth-scrolling as streamed content
 * grows; wheel/touch/keys mark an intentional departure so a programmatic
 * scroll never fights the reader. The optional preview-rail navigation was
 * not vendored (the transcript has no home for it — the export menu owns
 * that edge).
 */
export interface MessageScrollerProps extends ComponentPropsWithRef<'div'> {
  /** Keep streamed output pinned while the reader remains near the end. */
  followOutput?: boolean;
  /** Distance from the end that still counts as following the output. */
  followThreshold?: number;
  /** Smoothly follow growing content. */
  smooth?: boolean;
  /** Reports when the reader leaves or returns to the live edge. */
  onFollowChange?: (following: boolean) => void;
  /** Accessible label for the scrollable transcript. */
  label?: string;
  /** Marks the transcript as waiting for more streamed content. */
  busy?: boolean;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLElement>;
  viewportProps?: Omit<ComponentPropsWithRef<'section'>, 'children' | 'className' | 'ref'>;
}

export function MessageScroller({
  followOutput = true,
  followThreshold = 56,
  smooth = true,
  onFollowChange,
  label = 'Conversation',
  busy,
  viewportClassName,
  contentClassName,
  viewportRef: externalViewportRef,
  viewportProps,
  className,
  children,
  ...props
}: MessageScrollerProps) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(followOutput);
  const programmaticScrollRef = useRef(false);
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const {
    onScroll: onViewportScroll,
    onWheel: onViewportWheel,
    onTouchStart: onViewportTouchStart,
    onKeyDown: onViewportKeyDown,
    ...restViewportProps
  } = viewportProps ?? {};

  const setViewportRef = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node;
      if (typeof externalViewportRef === 'function') {
        externalViewportRef(node);
      } else if (externalViewportRef) {
        (externalViewportRef as { current: HTMLElement | null }).current = node;
      }
    },
    [externalViewportRef],
  );

  const setFollowing = useCallback(
    (next: boolean) => {
      if (followingRef.current === next) return;
      followingRef.current = next;
      onFollowChange?.(next);
    },
    [onFollowChange],
  );

  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Already at the end: no scroll event will follow, so never arm the
    // programmatic flag for a scroll that cannot happen.
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 1) return;

    programmaticScrollRef.current = true;
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
    // The flag clears when the viewport arrives at the end (handleScroll) or
    // when the reader intervenes (leaveLiveEdge); this timer is only the
    // fallback for an animation that never reports arrival. A fixed short
    // timer (ui13 job 15 regression) misread the tail of the engine's own
    // smooth scroll as the reader leaving: Chrome animates a 1000px re-pin
    // in ~470ms and 2000px in ~640ms, so any large landing turned follow off
    // and the transcript kept growing under a viewport that never moved.
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, behavior === 'smooth' ? 2000 : 100);
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (programmaticScrollRef.current) {
      // Scroll events from the engine's own scroll: only arrival matters.
      if (distance <= followThreshold) {
        programmaticScrollRef.current = false;
        if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      }
      return;
    }
    setFollowing(distance <= followThreshold);
  }, [followThreshold, setFollowing]);

  const leaveLiveEdge = useCallback(() => {
    programmaticScrollRef.current = false;
  }, []);

  useLayoutEffect(() => {
    followingRef.current = followOutput;
    if (!followOutput) return;

    frameRef.current = requestAnimationFrame(() => scrollToEnd('auto'));
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [followOutput, scrollToEnd]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!followOutput || !followingRef.current) return;
      scrollToEnd(reduce || !smooth ? 'auto' : 'smooth');
    });
    observer.observe(content);

    return () => observer.disconnect();
  }, [followOutput, reduce, scrollToEnd, smooth]);

  useEffect(
    () => () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div data-slot="message-scroller" className={cn('min-h-0', className)} {...props}>
      <section
        ref={setViewportRef}
        aria-label={label}
        {...restViewportProps}
        onScroll={(event) => {
          handleScroll();
          onViewportScroll?.(event);
        }}
        onWheel={(event) => {
          leaveLiveEdge();
          onViewportWheel?.(event);
        }}
        onTouchStart={(event) => {
          leaveLiveEdge();
          onViewportTouchStart?.(event);
        }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            leaveLiveEdge();
          }
          onViewportKeyDown?.(event);
        }}
        className={cn(
          'h-full overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          viewportClassName,
        )}
      >
        <div
          ref={contentRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          className={contentClassName}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
