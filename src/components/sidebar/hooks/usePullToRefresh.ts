import { useEffect, useRef, useState, type RefObject } from 'react';

/** Pull distance (damped px) that arms the refresh when released. */
export const PULL_REFRESH_THRESHOLD = 48;
/** Damped px the indicator holds at while the refresh is in flight. */
export const PULL_REFRESH_HOLD = 40;
const PULL_MAX = 80;

/**
 * Pull-to-refresh for the sidebar lists (mobile): dragging down from the top
 * of the scroll container pulls out an indicator; releasing past the
 * threshold fires onRefresh and holds the indicator until isRefreshing
 * clears. Listeners are native non-passive so the pull can cancel the scroll
 * gesture; with enabled=false nothing is attached (desktop keeps its button).
 */
export function usePullToRefresh({
  scrollRef,
  onRefresh,
  isRefreshing,
  enabled,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  isRefreshing: boolean;
  enabled: boolean;
}) {
  const [pull, setPull] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [held, setHeld] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const pullingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (held && !isRefreshing) {
      setHeld(false);
    }
  }, [held, isRefreshing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return undefined;

    const handleTouchStart = (event: TouchEvent) => {
      startYRef.current = el.scrollTop <= 0 ? event.touches[0].clientY : null;
      pullingRef.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (startYRef.current === null) {
        // The list may have been scrolled back to the top mid-gesture.
        if (el.scrollTop <= 0) {
          startYRef.current = event.touches[0].clientY;
        }
        return;
      }

      const delta = event.touches[0].clientY - startYRef.current;
      if (!pullingRef.current) {
        if (delta <= 0 || el.scrollTop > 0) {
          startYRef.current = el.scrollTop <= 0 ? event.touches[0].clientY : null;
          return;
        }
        pullingRef.current = true;
        setPulling(true);
      }

      event.preventDefault();
      const damped = Math.min(Math.pow(Math.max(delta, 0), 0.85), PULL_MAX);
      pullRef.current = damped;
      setPull(damped);
    };

    const handleTouchEnd = () => {
      startYRef.current = null;
      if (!pullingRef.current) return;
      pullingRef.current = false;
      setPulling(false);
      if (pullRef.current >= PULL_REFRESH_THRESHOLD) {
        setHeld(true);
        onRefreshRef.current();
      }
      pullRef.current = 0;
      setPull(0);
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [scrollRef, enabled]);

  const holding = held && isRefreshing;
  return {
    /** Current indicator height in px (live pull, or the hold while refreshing). */
    indicatorHeight: pulling ? pull : holding ? PULL_REFRESH_HOLD : 0,
    /** True mid-gesture (indicator tracks the finger, no transition). */
    pulling,
    /** True while the released refresh is still in flight. */
    holding,
    /** True once the live pull has passed the release threshold. */
    armed: pulling && pull >= PULL_REFRESH_THRESHOLD,
    pullProgress: Math.min(pull / PULL_REFRESH_THRESHOLD, 1),
  };
}
