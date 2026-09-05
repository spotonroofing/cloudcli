import { useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';

import { Button, Tooltip } from '../../shared/view/ui';
import { cn } from '../../lib/utils';

import { chainControlState, type ControllableChain } from './chainControlState';

export type ChainAction = 'pause' | 'resume' | 'stop';

type ChainControlsProps = {
  /** The chain the pane header names; null when none is live. */
  chain: ControllableChain | null;
  /** The action currently in flight, so its control reads as busy. */
  pending?: ChainAction | null;
  isMobile?: boolean;
  onAction: (action: ChainAction) => void;
};

/**
 * Chain controls in the worker pane header (audit1 job 8): pause and resume as
 * one toggling control, and stop behind a confirm sheet — so a chain going
 * wrong at 11pm is Willem's to stop from the app instead of a planner turn.
 * Both read the chain row's live state, and both are disabled with the reason
 * when no chain is running.
 */
export default function ChainControls({
  chain,
  pending = null,
  isMobile = false,
  onAction,
}: ChainControlsProps) {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const { toggle, canStop, reason } = chainControlState(chain);
  const toggleLabel = toggle === 'resume' ? 'Resume chain' : 'Pause chain';
  const togglePending = pending === 'pause' || pending === 'resume';

  return (
    <>
      <Tooltip content={reason ?? toggleLabel} position="bottom">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot="chain-pause-toggle"
          data-chain={chain?.slug ?? ''}
          data-chain-status={chain?.status ?? 'none'}
          data-action={toggle ?? 'none'}
          aria-label={reason ? `${toggleLabel} (unavailable): ${reason}` : toggleLabel}
          // A disabled control never fires the hover the Tooltip listens for,
          // so the reason also rides the native title.
          title={reason ?? undefined}
          disabled={!toggle || togglePending}
          onClick={() => toggle && onAction(toggle)}
          className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {toggle === 'resume'
            ? <Play className="h-3.5 w-3.5" />
            : <Pause className="h-3.5 w-3.5" />}
        </Button>
      </Tooltip>

      <Tooltip content={reason ?? 'Stop chain'} position="bottom">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot="chain-stop"
          data-chain={chain?.slug ?? ''}
          aria-label={reason ? `Stop chain (unavailable): ${reason}` : 'Stop chain'}
          title={reason ?? undefined}
          disabled={!canStop || pending === 'stop'}
          onClick={() => setConfirmingStop(true)}
          className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>

      {confirmingStop && chain && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Cancel stopping the chain"
            data-slot="chain-stop-scrim"
            className="fixed inset-0 z-[9998] bg-background/60 backdrop-blur-sm"
            onClick={() => setConfirmingStop(false)}
          />
          {/* A sheet, never a centered popup: the phone's bottom edge above the
              taskbar, the desktop's lower right. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Stop chain"
            data-slot="chain-stop-sheet"
            className={cn(
              'fixed z-[9999] flex flex-col gap-3 border border-border bg-popover p-4 shadow-lg',
              isMobile
                ? 'inset-x-0 rounded-t-lg border-x-0 border-b-0'
                : 'bottom-4 right-4 w-80 rounded-lg',
            )}
            style={isMobile
              ? {
                bottom: 'var(--mobile-taskbar-offset, 0px)',
                paddingBottom: 'calc(1rem + var(--safe-area-inset-bottom, 0px))',
              }
              : undefined}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Stop {chain.slug}?</p>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">
                The job being worked on is parked the way a pause parks it, and the chain ends as
                stopped. Nothing queued after it runs.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                data-slot="chain-stop-cancel"
                className="h-11 px-3 text-sm md:h-8"
                onClick={() => setConfirmingStop(false)}
              >
                Keep running
              </Button>
              <Button
                type="button"
                variant="destructive"
                data-slot="chain-stop-confirm"
                className="h-11 px-3 text-sm md:h-8"
                onClick={() => {
                  setConfirmingStop(false);
                  onAction('stop');
                }}
              >
                Stop chain
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
