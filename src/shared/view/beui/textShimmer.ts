import type { CSSProperties } from 'react';

// beUI text-shimmer (beui.dev/components/agents/loading-states), vendored.
// The only retheme: this app's color tokens are HSL triplets, so the gradient
// stops wrap them in hsl(). The reduced-motion rule travels with the component;
// `!important` because the sweep is an inline style, which outranks a plain
// rule in a media query.
export const TEXT_SHIMMER_KEYFRAMES =
  '@keyframes beui-text-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}' +
  '@media (prefers-reduced-motion: reduce){.beui-text-shimmer{animation:none !important}}';

export const TEXT_SHIMMER_CLASS_NAME =
  'beui-text-shimmer bg-[length:200%_100%] bg-clip-text text-transparent bg-[linear-gradient(110deg,hsl(var(--muted-foreground))_30%,hsl(var(--foreground))_50%,hsl(var(--muted-foreground))_70%)]';

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}
