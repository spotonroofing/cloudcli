import { cn } from '../../../lib/utils';

/**
 * beautifului.dev Loading State (www.beautifului.dev), vendored from its
 * public source mirror and rethemed to this app's tokens: a 3x3 pixel-grid
 * loading mark. Every variant uses the same dim-resting-state fade; only its
 * wavefront geometry changes. The complete catalog is documented in
 * design/transcript-rows.md.
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

const SPIRAL_ORDER = [0, 1, 2, 5, 8, 7, 6, 3, 4];
const spiralDelays = Array.from({ length: 9 }, (_, index) => SPIRAL_ORDER.indexOf(index) * 85);

export type PixelLoaderVariant =
  | 'drive'
  | 'dots'
  | 'orbit'
  | 'pulse'
  | 'scan'
  | 'spiral'
  | 'diagonal'
  | 'breathe'
  | 'checker'
  | 'rain'
  | 'converge'
  | 'columns';

type PixelPattern = {
  delays: readonly (number | null)[];
  duration: number;
  round: boolean;
};

const PATTERNS: Record<PixelLoaderVariant, PixelPattern> = {
  drive: { delays: chevronDelays, duration: 650, round: false },
  dots: { delays: chevronDelays, duration: 650, round: true },
  orbit: { delays: orbitDelays, duration: 950, round: false },
  pulse: { delays: [180, 90, 180, 90, 0, 90, 180, 90, 180], duration: 820, round: false },
  scan: { delays: [0, 0, 0, 140, 140, 140, 280, 280, 280], duration: 900, round: false },
  spiral: { delays: spiralDelays, duration: 980, round: false },
  diagonal: { delays: [0, 90, 180, 90, 180, 270, 180, 270, 360], duration: 900, round: false },
  breathe: { delays: Array(9).fill(0), duration: 1_100, round: false },
  checker: { delays: [0, 260, 0, 260, 0, 260, 0, 260, 0], duration: 900, round: false },
  rain: { delays: [70, 0, 70, 170, 100, 170, 270, 200, 270], duration: 820, round: false },
  converge: { delays: [0, 110, 0, 110, 220, 110, 0, 110, 0], duration: 820, round: false },
  columns: { delays: [160, 0, 160, 160, 0, 160, 160, 0, 160], duration: 900, round: false },
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
    <span
      aria-hidden="true"
      data-slot="pixel-loader"
      data-pattern={variant}
      data-shape={round ? 'round' : 'square'}
      className={cn('grid grid-cols-[repeat(3,4px)] gap-[1.5px]', className)}
    >
      {delays.map((delay, index) => (
        <span
          key={index}
          data-cell={index}
          data-column={index % 3}
          data-row={Math.floor(index / 3)}
          className={`bui-pixel-cell size-[4px] bg-foreground ${round ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null
              ? 'none'
              : `bui-pixel-on ${duration}ms cubic-bezier(0.77, 0, 0.175, 1) ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}
