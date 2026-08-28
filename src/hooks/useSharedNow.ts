import { useCallback, useSyncExternalStore } from 'react';

type Clock = {
  now: number;
  listeners: Set<() => void>;
  timer: number | null;
  cadence: number;
};

const clocks = new Map<number, Clock>();

function getClock(cadence: number): Clock {
  const existing = clocks.get(cadence);
  if (existing) return existing;
  const clock: Clock = {
    now: Date.now(),
    listeners: new Set(),
    timer: null,
    cadence,
  };
  clocks.set(cadence, clock);
  return clock;
}

function stopClock(clock: Clock) {
  if (clock.timer !== null) {
    window.clearInterval(clock.timer);
    clock.timer = null;
  }
}

function startClock(clock: Clock) {
  if (clock.timer !== null || clock.listeners.size === 0 || document.hidden) return;
  clock.timer = window.setInterval(() => {
    clock.now = Date.now();
    for (const listener of clock.listeners) listener();
  }, clock.cadence);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const clock of clocks.values()) {
      if (document.hidden) {
        stopClock(clock);
      } else {
        clock.now = Date.now();
        for (const listener of clock.listeners) listener();
        startClock(clock);
      }
    }
  });
}

/** One shared, visibility-aware clock per cadence, never one timer per row. */
export function useSharedNow(enabled: boolean, cadence = 1000): number {
  const clock = getClock(cadence);
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) return () => undefined;
    clock.listeners.add(listener);
    startClock(clock);
    return () => {
      clock.listeners.delete(listener);
      if (clock.listeners.size === 0) stopClock(clock);
    };
  }, [clock, enabled]);
  const getSnapshot = useCallback(() => clock.now, [clock]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
