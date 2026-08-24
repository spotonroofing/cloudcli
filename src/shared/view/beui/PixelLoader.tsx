import { cn } from '../../../lib/utils';

/**
 * beautifului.dev Loading State (www.beautifului.dev), vendored from its
 * public source mirror and rethemed to this app's tokens: a 3x3 pixel-grid
 * loading mark. Variants:
 *   drive — square cells, a chevron wavefront driving right; the 650ms cycle
 *           is shorter than the sweep, so two fronts are always in flight
 *   dots  — the same wavefront on circular cells
 *   orbit — a comet lapping the grid perimeter
 * Keyframes (`bui-pixel-on`) live in src/index.css; reduced motion freezes
 * the grid at its dim resting state via the `bui-pixel-cell` override.
 */

const chevronDelays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const col = index % 3;
  return (col + Math.abs(row - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbitDelays = Array.from({ length: 9 }, (_, index) => {
  const step = ORBIT_ORDER.indexOf(index);
  return step === -1 ? null : step * 110;
});

export type PixelLoaderVariant = 'drive' | 'dots' | 'orbit';

const PATTERNS: Record<PixelLoaderVariant, { delays: (number | null)[]; duration: number; round: boolean }> = {
  drive: { delays: chevronDelays, duration: 650, round: false },
  dots: { delays: chevronDelays, duration: 650, round: true },
  orbit: { delays: orbitDelays, duration: 950, round: false },
};

export function PixelLoader({
  variant = 'drive',
  className,
}: {
  variant?: PixelLoaderVariant;
  className?: string;
}) {
  const { delays, duration, round } = PATTERNS[variant];

  return (
    <span aria-hidden="true" className={cn('grid grid-cols-[repeat(3,4px)] gap-[1.5px]', className)}>
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`bui-pixel-cell size-[4px] bg-foreground ${round ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? 'none' : `bui-pixel-on ${duration}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}
