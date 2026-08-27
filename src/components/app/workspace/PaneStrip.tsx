import { Fragment, useRef } from 'react';
import type React from 'react';
import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

import { SnapGuides, useSnapDivider } from './dividerSnap';
import type { WindowId } from './useProjectWindows';

type PaneDividerProps = {
  orientation: 'vertical' | 'horizontal';
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  dataSlot?: string;
};

/**
 * The one pane divider (ui13 job 10): rests hairline-thin — the sidebar edge
 * border's weight — and expands (ramped) to the grab width with the resize
 * cursor on hover or drag. The pointer hit area is wider than the visual
 * line, so it stays grabbable on touch without a fat resting bar.
 */
export function PaneDivider({
  orientation,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  dataSlot = 'pane-divider',
}: PaneDividerProps) {
  const vertical = orientation === 'vertical';
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      data-slot={dataSlot}
      className={cn('group/divider relative flex-shrink-0', vertical ? 'w-px' : 'h-px')}
    >
      <div
        aria-hidden="true"
        data-slot="pane-divider-line"
        className={cn(
          'pointer-events-none absolute bg-border/50 transition-[width,height,background-color] duration-200 ease-[cubic-bezier(0.77,0,0.175,1)]',
          'group-hover/divider:bg-primary group-active/divider:bg-primary',
          vertical
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover/divider:w-1 group-active/divider:w-1'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2 group-hover/divider:h-1 group-active/divider:h-1',
        )}
      />
      <div
        data-slot="pane-divider-hit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={cn(
          'absolute z-20 touch-none',
          vertical
            ? '-left-1.5 -right-1.5 inset-y-0 cursor-col-resize'
            : '-top-1.5 -bottom-1.5 inset-x-0 cursor-row-resize',
        )}
      />
    </div>
  );
}

export type StripPane = {
  id: WindowId;
  state: 'open' | 'rail';
  /** Rotated label on the collapsed rail. */
  railLabel: string;
  weight: number;
  minWidth: number;
  onExpand: () => void;
  content: ReactNode;
};

type PaneStripProps = {
  panes: StripPane[];
  onPairWeights: (idA: WindowId, weightA: number, idB: WindowId, weightB: number) => void;
};

/**
 * A project's window strip (ui13 job 10): its open windows tiled side by side
 * inside the workspace grid — no freeform floating, no z-order — with the
 * hairline dividers between adjacent open panes and collapsed windows as thin
 * rotated-text rails attached in place, squishing the nearest open pane.
 * Open panes stay mounted while railed is not needed: a railed pane's content
 * unmount is the caller's choice via the descriptor list.
 */
export default function PaneStrip({ panes, onPairWeights }: PaneStripProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const snap = useSnapDivider<WindowId>({
    containerRef,
    minFraction: () => 0.15,
    onCommit: onPairWeights,
  });

  const handleDividerPointerDown =
    (idA: WindowId, idB: WindowId) => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const elA = container.querySelector<HTMLElement>(`[data-strip-pane="${idA}"]`);
      const elB = container.querySelector<HTMLElement>(`[data-strip-pane="${idB}"]`);
      if (!elA || !elB) {
        return;
      }
      const paneA = panes.find((pane) => pane.id === idA);
      const paneB = panes.find((pane) => pane.id === idB);
      snap.beginDrag(event, {
        idA,
        idB,
        elA,
        elB,
        horizontal: true,
        total: (paneA?.weight ?? 1) + (paneB?.weight ?? 1),
      });
    };

  return (
    <div ref={containerRef} data-slot="pane-strip" className="relative flex h-full min-h-0 min-w-0 flex-1">
      {panes.map((pane, index) => {
        // A divider sits between two open panes that touch directly; a rail
        // at the boundary is its own separator.
        const previous = panes[index - 1];
        const needsDivider = index > 0 && previous?.state === 'open' && pane.state === 'open';
        return (
          <Fragment key={pane.id}>
            {needsDivider && previous && (
              <PaneDivider
                orientation="vertical"
                onPointerDown={handleDividerPointerDown(previous.id, pane.id)}
                onPointerMove={snap.moveDrag}
                onPointerUp={snap.endDrag}
                onPointerCancel={snap.endDrag}
              />
            )}
            {pane.state === 'rail' ? (
              <button
                type="button"
                onClick={pane.onExpand}
                data-slot="pane-rail"
                data-window={pane.id}
                className={cn(
                  'flex w-6 flex-shrink-0 items-center justify-center bg-muted/30 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
                  index > 0 && 'border-l border-border/50',
                  index < panes.length - 1 && 'border-r border-border/50',
                )}
                title={`Show ${pane.railLabel}`}
                aria-label={`Show ${pane.railLabel}`}
              >
                <span className="rotate-90 whitespace-nowrap text-[10px] font-medium tracking-wide">
                  {pane.railLabel}
                </span>
              </button>
            ) : (
              <div
                data-strip-pane={pane.id}
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ flex: `${pane.weight} 1 0px`, minWidth: pane.minWidth }}
              >
                {pane.content}
              </div>
            )}
          </Fragment>
        );
      })}
      <SnapGuides guide={snap.guides} />
    </div>
  );
}
