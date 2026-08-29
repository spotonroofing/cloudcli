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
import {
  applyGestureSettled,
  applyReaderGesture,
  applyRepinStarted,
  applyScroll,
  createFollowState,
  shouldRepin,
} from './followOutput';

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
/** How long after a reader gesture the engine re-reads the true scroll position. */
const GESTURE_SETTLE_MS = 400;

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
  const followRef = useRef(createFollowState(followOutput));
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const settleTimerRef = useRef<number | undefined>(undefined);
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

  const commitFollowState = useCallback(
    (next: typeof followRef.current) => {
      const wasFollowing = followRef.current.following;
      followRef.current = next;
      if (next.following !== wasFollowing) onFollowChange?.(next.following);
    },
    [onFollowChange],
  );

  const distanceFromEnd = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }, []);

  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Already at the end: no scroll event will follow, so never arm the
    // programmatic flag for a scroll that cannot happen.
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 1) return;

    followRef.current = applyRepinStarted(followRef.current);
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
      followRef.current = { ...followRef.current, programmatic: false };
    }, behavior === 'smooth' ? 2000 : 100);
  }, []);

  // A reader gesture that produced no scroll event (a wheel with nothing left
  // to scroll) settles on the viewport's real distance instead of leaving the
  // departure latch, and the engine, stuck.
  const armGestureSettle = useCallback(() => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      commitFollowState(applyGestureSettled(followRef.current, distanceFromEnd(), followThreshold));
    }, GESTURE_SETTLE_MS);
  }, [commitFollowState, distanceFromEnd, followThreshold]);

  const handleScroll = useCallback(() => {
    if (!viewportRef.current) return;
    const wasDeparted = followRef.current.departed;
    const next = applyScroll(followRef.current, distanceFromEnd(), followThreshold);
    if (!next.programmatic && scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    commitFollowState(next);
    if (next.departed) {
      armGestureSettle();
    } else if (wasDeparted && settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
    }
  }, [armGestureSettle, commitFollowState, distanceFromEnd, followThreshold]);

  // Wheel, touch and page keys: the reader's departure lands before the scroll
  // event does, so a resize arriving in between can never repin over them.
  const leaveLiveEdge = useCallback(() => {
    commitFollowState(applyReaderGesture(followRef.current));
    armGestureSettle();
  }, [armGestureSettle, commitFollowState]);

  useLayoutEffect(() => {
    followRef.current = createFollowState(followOutput);
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
      if (!shouldRepin(followRef.current, followOutput)) return;
      scrollToEnd(reduce || !smooth ? 'auto' : 'smooth');
    });
    observer.observe(content);

    return () => observer.disconnect();
  }, [followOutput, reduce, scrollToEnd, smooth]);

  useEffect(
    () => () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
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
