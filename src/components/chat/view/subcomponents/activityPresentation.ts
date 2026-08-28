import type { PixelLoaderVariant } from '../../../../shared/view/beui';

type ActivityPresentation = { word: string; variant: PixelLoaderVariant };

export const ACTIVITY_PRESENTATIONS = [
  { word: 'Thinking', variant: 'drive' },
  { word: 'Working', variant: 'dots' },
  { word: 'Churning', variant: 'orbit' },
  { word: 'Discombobulating', variant: 'spiral' },
  { word: 'Percolating', variant: 'rain' },
  { word: 'Marinating', variant: 'breathe' },
  { word: 'Noodling', variant: 'diagonal' },
  { word: 'Cogitating', variant: 'pulse' },
  { word: 'Ruminating', variant: 'converge' },
  { word: 'Tinkering', variant: 'checker' },
  { word: 'Mulling', variant: 'scan' },
  { word: 'Brewing', variant: 'columns' },
] as const satisfies readonly ActivityPresentation[];

export const ACTIVITY_ROTATION_MS = 5_000;
export const ACTIVITY_SWAP_MS = 220;

export function pickNextPresentationIndex(
  recentIndices: readonly number[],
  random: () => number = Math.random,
): number {
  const excluded = new Set(recentIndices.slice(-2));
  const available = ACTIVITY_PRESENTATIONS
    .map((_, index) => index)
    .filter((index) => !excluded.has(index));
  const sample = Math.min(0.999_999, Math.max(0, random()));
  return available[Math.floor(sample * available.length)];
}
