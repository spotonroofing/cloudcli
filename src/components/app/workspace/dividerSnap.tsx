import { useEffect, useRef, useState } from 'react';
import type React from 'react';

import { cn } from '../../../lib/utils';

/**
 * Divider snap stops (ui15 job 1): the fraction of the pair a drag can land
 * on — quarters, thirds, and the even split. Dense enough for deliberate
 * layouts, sparse enough that every stop means something.
 */
export const SNAP_STOPS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75];

const SETTLE_MS = 200;
const GUIDE_FADE_MS = 200;
const EASE_IN_OUT = 'cubic-bezier(0.77,0,0.175,1)';

export type SnapGuideState = {
  /** Drag axis is horizontal (a vertical divider between side-by-side panes). */
  horizontal: boolean;
  /** Pair's leading edge relative to the positioned container, px. */
  offset: number;
  /** Pair's combined size along the drag axis, px. */
  size: number;
  /** Stops reachable under the pair's min-size constraint. */
  stops: number[];
  /** Release happened; guides are fading out. */
  fading: boolean;
};

type ActiveDrag<Id extends string> = {
  idA: Id;
  idB: Id;
  elA: HTMLElement;
  elB: HTMLElement;
  horizontal: boolean;
  /** Pair's leading edge along the drag axis, viewport px. */
  origin: number;
  pixels: number;
  /** weightA + weightB — the pair's share of the flex row stays constant. */
  total: number;
  minFraction: number;
  fraction: number;
};

type BeginDragConfig<Id extends string> = {
  idA: Id;
  idB: Id;
  elA: HTMLElement;
  elB: HTMLElement;
  horizontal: boolean;
  total: number;
};

/**
 * Divider drag with instant tracking and notched release (ui15 job 1).
 * Pointermove writes the pair's flex weights straight to the DOM — no React
 * state, no persistence, so the divider moves in the same frame as the
 * pointer. Release snaps to the nearest stop with a short ramped settle and
 * only then commits the weights through `onCommit` (the persisted store).
 */
export function useSnapDivider<Id extends string>({
  containerRef,
  minFraction,
  onCommit,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Smallest allowed fraction for either pane, given the pair's pixel size. */
  minFraction: (pixels: number) => number;
  onCommit: (idA: Id, weightA: number, idB: Id, weightB: number) => void;
}) {
  const dragRef = useRef<ActiveDrag<Id> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [guides, setGuides] = useState<SnapGuideState | null>(null);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    { idA, idB, elA, elB, horizontal, total }: BeginDragConfig<Id>,
  ) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();
    const pixels = horizontal ? rectA.width + rectB.width : rectA.height + rectB.height;
    if (pixels <= 0) {
      return;
    }
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    elA.style.transition = '';
    elB.style.transition = '';
    const min = Math.min(0.5, minFraction(pixels));
    const origin = horizontal ? rectA.left : rectA.top;
    const containerRect = container.getBoundingClientRect();
    dragRef.current = {
      idA,
      idB,
      elA,
      elB,
      horizontal,
      origin,
      pixels,
      total,
      minFraction: min,
      fraction: (horizontal ? rectA.width : rectA.height) / pixels,
    };
    setGuides({
      horizontal,
      offset: origin - (horizontal ? containerRect.left : containerRect.top),
      size: pixels,
      stops: SNAP_STOPS.filter((stop) => stop >= min && stop <= 1 - min),
      fading: false,
    });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events (tests) have no capturable pointer.
    }
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const pointer = drag.horizontal ? event.clientX : event.clientY;
    const fraction = Math.min(
      1 - drag.minFraction,
      Math.max(drag.minFraction, (pointer - drag.origin) / drag.pixels),
    );
    drag.fraction = fraction;
    drag.elA.style.flex = `${fraction * drag.total} 1 0px`;
    drag.elB.style.flex = `${(1 - fraction) * drag.total} 1 0px`;
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    const stops = SNAP_STOPS.filter(
      (stop) => stop >= drag.minFraction && stop <= 1 - drag.minFraction,
    );
    const nearest = stops.reduce(
      (best, stop) => (Math.abs(stop - drag.fraction) < Math.abs(best - drag.fraction) ? stop : best),
      0.5,
    );
    drag.elA.style.transition = `flex-grow ${SETTLE_MS}ms ${EASE_IN_OUT}`;
    drag.elB.style.transition = `flex-grow ${SETTLE_MS}ms ${EASE_IN_OUT}`;
    drag.elA.style.flex = `${nearest * drag.total} 1 0px`;
    drag.elB.style.flex = `${(1 - nearest) * drag.total} 1 0px`;
    setGuides((previous) => (previous ? { ...previous, fading: true } : previous));
    timersRef.current.push(
      setTimeout(() => {
        drag.elA.style.transition = '';
        drag.elB.style.transition = '';
        onCommit(drag.idA, nearest * drag.total, drag.idB, (1 - nearest) * drag.total);
      }, SETTLE_MS),
      setTimeout(() => setGuides(null), Math.max(SETTLE_MS, GUIDE_FADE_MS) + 50),
    );
  };

  return { guides, beginDrag, moveDrag, endDrag };
}

/**
 * The stop marks shown while a divider drags (ui15 job 1): small primary
 * ticks along the trailing edge of the paired panes — the bottom for
 * side-by-side panes, the right edge for stacked rows — one per reachable
 * stop, the center (even split) tick double height. They fade out on release.
 */
export function SnapGuides({ guide }: { guide: SnapGuideState | null }) {
  if (!guide) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      data-slot="divider-snap-guides"
      className="pointer-events-none absolute inset-0 z-30"
    >
      {guide.stops.map((stop) => {
        const along = guide.offset + stop * guide.size;
        const center = Math.abs(stop - 0.5) < 0.001;
        const length = center ? 16 : 8;
        return (
          <div
            key={stop}
            data-slot="divider-snap-stop"
            data-center={center || undefined}
            className={cn(
              'absolute rounded-full bg-primary/70 transition-opacity duration-200',
              guide.fading && 'opacity-0',
            )}
            style={
              guide.horizontal
                ? { left: along - 1, bottom: 4, width: 2, height: length }
                : { top: along - 1, right: 4, height: 2, width: length }
            }
          />
        );
      })}
    </div>
  );
}
