import type { CSSProperties } from 'react';

import { cn } from '../../../lib/utils';

/**
 * The one app-wide loading placeholder (ui11 phase 11): a content-shaped
 * pulsing block that holds the space of the element still arriving. Compose
 * per surface (rows, bubbles, bars); a skeleton always gives way to content,
 * never to a blank. Pinned overlays and action states keep the beUI Loader.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      style={style}
      className={cn('animate-pulse rounded-md bg-muted/70 motion-reduce:animate-none', className)}
    />
  );
}
