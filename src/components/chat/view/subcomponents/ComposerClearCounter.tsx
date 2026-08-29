import { useCallback, useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * The character counter doubles as the clear control (ui15 job 2 anatomy,
 * restored by ui17 job 9): the count crossfades into an X on hover, and the
 * clear itself now takes two taps so a draft is never lost to one slip.
 */
export const CLEAR_ARM_WINDOW_MS = 2000;

export type ClearTapState = 'idle' | 'armed';

/** Pure step for a tap on the counter, so the two-tap rule is testable. */
export function clearTapOutcome(state: ClearTapState, canClear: boolean): 'ignore' | 'arm' | 'clear' {
  if (!canClear) return 'ignore';
  return state === 'idle' ? 'arm' : 'clear';
}

interface ComposerClearCounterProps {
  length: number;
  canClear: boolean;
  clearUndoPending: boolean;
  onClearComposer: () => void;
  onUndoClear: () => void;
}

export default function ComposerClearCounter({
  length,
  canClear,
  clearUndoPending,
  onClearComposer,
  onUndoClear,
}: ComposerClearCounterProps) {
  const { t } = useTranslation();
  const [tapState, setTapState] = useState<ClearTapState>('idle');
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (armTimer.current) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    setTapState('idle');
  }, []);

  // Nothing to clear, or the undo window took over: the arm never survives it.
  useEffect(() => {
    if (!canClear || clearUndoPending) disarm();
  }, [canClear, clearUndoPending, disarm]);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  // Escape disarms wherever focus sits.
  useEffect(() => {
    if (tapState !== 'armed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') disarm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disarm, tapState]);

  const onTap = useCallback(() => {
    const outcome = clearTapOutcome(tapState, canClear);
    if (outcome === 'ignore') return;
    if (outcome === 'arm') {
      setTapState('armed');
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => {
        armTimer.current = null;
        setTapState('idle');
      }, CLEAR_ARM_WINDOW_MS);
      return;
    }
    disarm();
    onClearComposer();
  }, [canClear, disarm, onClearComposer, tapState]);

  if (clearUndoPending) {
    return (
      <button
        type="button"
        data-slot="composer-undo-clear"
        onClick={onUndoClear}
        className="touch-hit relative flex h-7 shrink-0 items-center rounded-md px-1.5 pb-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {t('input.undoClear', { defaultValue: 'Undo?' })}
        <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-sm bg-muted-foreground/20">
          <span className="undo-deplete block h-full w-full rounded-sm bg-muted-foreground/60" />
        </span>
      </button>
    );
  }

  const armed = tapState === 'armed';

  return (
    <button
      type="button"
      data-slot="char-counter"
      data-armed={armed ? '' : undefined}
      onClick={canClear ? onTap : undefined}
      onPointerLeave={armed ? disarm : undefined}
      disabled={!canClear}
      aria-label={
        armed
          ? t('input.clearArmed', { defaultValue: 'Tap again to clear' })
          : t('input.clear', { defaultValue: 'Clear message' })
      }
      className="group/counter touch-hit relative grid h-7 min-w-5 shrink-0 place-items-center px-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground disabled:cursor-default"
    >
      <span
        className={`counter-swap col-start-1 row-start-1 ${
          armed ? 'opacity-0' : canClear ? 'group-hover/counter:opacity-0 group-focus-visible/counter:opacity-0' : ''
        }`}
      >
        {length.toLocaleString('en-US')}
      </span>

      {canClear && (
        <XIcon
          aria-hidden
          data-slot="composer-clear"
          className={`counter-swap col-start-1 row-start-1 h-3.5 w-3.5 opacity-0 ${
            armed ? '' : 'group-hover/counter:opacity-100 group-focus-visible/counter:opacity-100'
          }`}
        />
      )}

      {canClear && (
        <span
          data-slot="composer-clear-armed"
          aria-hidden={!armed}
          className={`counter-swap pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap font-sans text-[11px] font-medium text-foreground ${armed ? 'opacity-100' : 'opacity-0'}`}
        >
          {t('input.clearArmed', { defaultValue: 'Tap again to clear' })}
        </span>
      )}
    </button>
  );
}
