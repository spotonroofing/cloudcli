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
  leadingBasisPixels: number;
  trailingBasisPixels: number;
  minLeadingFraction: number;
  minTrailingFraction: number;
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

export type DividerMinimums = {
  leading: number;
  trailing: number;
};

/**
 * Turns the two panes' real CSS minimums into legal visual fractions. Keeping
 * the two sides separate matters: Planner and Worker do not always have the
 * same minimum, especially inside a narrow multi-project column.
 */
export const dividerMinimumFractions = (
  leadingPixels: number,
  trailingPixels: number,
  pairPixels: number,
): DividerMinimums => {
  if (pairPixels <= 0) {
    return { leading: 0, trailing: 0 };
  }
  const leading = Math.max(0, leadingPixels) / pairPixels;
  const trailing = Math.max(0, trailingPixels) / pairPixels;
  const total = leading + trailing;
  if (total <= 1) {
    return { leading, trailing };
  }
  // A strip narrower than the two declared minimums is already overflowing.
  // Normalizing keeps the divider stable at the only proportional boundary
  // instead of advertising snap stops that CSS cannot render.
  return { leading: leading / total, trailing: trailing / total };
};

export const reachableSnapStops = ({ leading, trailing }: DividerMinimums): number[] =>
  SNAP_STOPS.filter((stop) => stop >= leading && stop <= 1 - trailing);

export type DividerWeights = {
  leading: number;
  trailing: number;
};

/**
 * Flex-grow operates only on space left after flex-basis. Convert a requested
 * visual boundary back to grow weights so a responsive jobs basis stays in
 * place without making the divider lag behind the pointer.
 */
export const flexWeightsForVisualFraction = (
  fraction: number,
  totalWeight: number,
  pairPixels: number,
  leadingBasisPixels: number,
  trailingBasisPixels: number,
): DividerWeights => {
  const freePixels = pairPixels - leadingBasisPixels - trailingBasisPixels;
  if (freePixels <= 0) {
    return { leading: fraction * totalWeight, trailing: (1 - fraction) * totalWeight };
  }
  const leadingShare = Math.min(
    1,
    Math.max(0, ((fraction * pairPixels) - leadingBasisPixels) / freePixels),
  );
  return {
    leading: leadingShare * totalWeight,
    trailing: (1 - leadingShare) * totalWeight,
  };
};

const flexBasisPixels = (element: HTMLElement): number => {
  const basis = Number.parseFloat(getComputedStyle(element).flexBasis);
  return Number.isFinite(basis) ? Math.max(0, basis) : 0;
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
  minFractions,
  onCommit,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Smallest allowed visual fraction for each pane in the active pair. */
  minFractions: (pixels: number, idA: Id, idB: Id) => DividerMinimums;
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
    const leadingBasisPixels = flexBasisPixels(elA);
    const trailingBasisPixels = flexBasisPixels(elB);
    const declaredMinimums = minFractions(pixels, idA, idB);
    const minimums = dividerMinimumFractions(
      Math.max(declaredMinimums.leading * pixels, leadingBasisPixels),
      Math.max(declaredMinimums.trailing * pixels, trailingBasisPixels),
      pixels,
    );
    const minLeadingFraction = Math.min(1, Math.max(0, minimums.leading));
    const minTrailingFraction = Math.min(1 - minLeadingFraction, Math.max(0, minimums.trailing));
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
      leadingBasisPixels,
      trailingBasisPixels,
      minLeadingFraction,
      minTrailingFraction,
      fraction: (horizontal ? rectA.width : rectA.height) / pixels,
    };
    setGuides({
      horizontal,
      offset: origin - (horizontal ? containerRect.left : containerRect.top),
      size: pixels,
      stops: reachableSnapStops({ leading: minLeadingFraction, trailing: minTrailingFraction }),
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
      1 - drag.minTrailingFraction,
      Math.max(drag.minLeadingFraction, (pointer - drag.origin) / drag.pixels),
    );
    drag.fraction = fraction;
    const weights = flexWeightsForVisualFraction(
      fraction,
      drag.total,
      drag.pixels,
      drag.leadingBasisPixels,
      drag.trailingBasisPixels,
    );
    drag.elA.style.flexGrow = String(weights.leading);
    drag.elB.style.flexGrow = String(weights.trailing);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    const stops = reachableSnapStops({
      leading: drag.minLeadingFraction,
      trailing: drag.minTrailingFraction,
    });
    const fallback = Math.min(
      1 - drag.minTrailingFraction,
      Math.max(drag.minLeadingFraction, drag.fraction),
    );
    const nearest = stops.length > 0
      ? stops.reduce(
        (best, stop) => (Math.abs(stop - drag.fraction) < Math.abs(best - drag.fraction) ? stop : best),
        stops[0],
      )
      : fallback;
    const weights = flexWeightsForVisualFraction(
      nearest,
      drag.total,
      drag.pixels,
      drag.leadingBasisPixels,
      drag.trailingBasisPixels,
    );
    drag.elA.style.transition = `flex-grow ${SETTLE_MS}ms ${EASE_IN_OUT}`;
    drag.elB.style.transition = `flex-grow ${SETTLE_MS}ms ${EASE_IN_OUT}`;
    drag.elA.style.flexGrow = String(weights.leading);
    drag.elB.style.flexGrow = String(weights.trailing);
    setGuides((previous) => (previous ? { ...previous, fading: true } : previous));
    timersRef.current.push(
      setTimeout(() => {
        drag.elA.style.transition = '';
        drag.elB.style.transition = '';
        onCommit(drag.idA, weights.leading, drag.idB, weights.trailing);
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
