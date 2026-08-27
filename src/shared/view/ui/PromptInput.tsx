"use client";

import * as React from 'react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { ActionSwapIcon } from '../beui/ActionSwap';
import { Button } from './Button';
import Tooltip from './Tooltip';

/* ─── Context ────────────────────────────────────────────────────── */

type PromptInputStatus = 'ready' | 'submitted' | 'streaming' | 'error';

interface PromptInputContextValue {
  status: PromptInputStatus;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(null);

const usePromptInput = () => {
  const context = React.useContext(PromptInputContext);
  if (!context) {
    throw new Error('PromptInput components must be used within PromptInput');
  }
  return context;
};

/* ─── PromptInput (root form) ────────────────────────────────────── */

export interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  status?: PromptInputStatus;
}

export const PromptInput = React.forwardRef<HTMLFormElement, PromptInputProps>(
  ({ className, status = 'ready', children, ...props }, ref) => {
    const contextValue = React.useMemo(() => ({ status }), [status]);

    return (
      <PromptInputContext.Provider value={contextValue}>
        {/* The focus treatment (border + ring + blur glow) lives on one overlay
            sibling fading through a single opacity channel (ui13 job 12): a
            crossfade of border color, ring, and mismatched shadow lists on the
            form itself could not fade monotonically. The overlay sits outside
            the form because overflow-hidden would clip its outward glow; the
            shell's :focus-within drives it via .prompt-input-focus-glow in
            index.css. */}
        <div data-slot="prompt-input-shell" className="relative">
          <form
            ref={ref}
            data-slot="prompt-input"
            className={cn(
              'relative overflow-hidden rounded-lg border border-border/50 bg-card/80 shadow-sm backdrop-blur-sm',
              className
            )}
            {...props}
          >
            {children}
          </form>
          <div
            aria-hidden="true"
            data-slot="prompt-input-focus-glow"
            className="prompt-input-focus-glow pointer-events-none absolute inset-0 rounded-lg border border-muted-foreground/40 opacity-0 shadow-md ring-1 ring-muted-foreground/20"
          />
        </div>
      </PromptInputContext.Provider>
    );
  }
);
PromptInput.displayName = 'PromptInput';

/* ─── PromptInputHeader ──────────────────────────────────────────── */

export const PromptInputHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-header"
    className={cn('px-3 pt-3', className)}
    {...props}
  />
));
PromptInputHeader.displayName = 'PromptInputHeader';

/* ─── PromptInputBody ────────────────────────────────────────────── */

export const PromptInputBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-body"
    className={cn('relative', className)}
    {...props}
  />
));
PromptInputBody.displayName = 'PromptInputBody';

/* ─── PromptInputTextarea ────────────────────────────────────────── */

export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={1}
    // No browser spell/grammar squiggles anywhere prompts are typed (ui15 job
    // 2); autocapitalize stays on sentences for phone dictation.
    spellCheck={false}
    autoCorrect="off"
    autoCapitalize="sentences"
    data-slot="prompt-input-textarea"
    className={cn(
      // text-base below md keeps iOS Safari from zooming the viewport on focus.
      'chat-input-placeholder block max-h-[40dvh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2 text-base leading-6 text-foreground placeholder-muted-foreground/50 focus:outline-none sm:max-h-[300px] md:text-sm',
      className
    )}
    {...props}
  />
));
PromptInputTextarea.displayName = 'PromptInputTextarea';

/* ─── PromptInputFooter ──────────────────────────────────────────── */

export const PromptInputFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-footer"
    className={cn('flex items-center justify-between px-3 py-2', className)}
    {...props}
  />
));
PromptInputFooter.displayName = 'PromptInputFooter';

/* ─── PromptInputTools ───────────────────────────────────────────── */

export const PromptInputTools = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-tools"
    className={cn('flex items-center gap-1', className)}
    {...props}
  />
));
PromptInputTools.displayName = 'PromptInputTools';

/* ─── PromptInputButton ──────────────────────────────────────────── */

export interface PromptInputButtonTooltip {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export interface PromptInputButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: PromptInputButtonTooltip;
}

export const PromptInputButton = React.forwardRef<HTMLButtonElement, PromptInputButtonProps>(
  ({ className, tooltip, children, ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon"
        className={cn('touch-hit relative h-8 w-8 [&_svg]:size-4', className)}
        {...props}
      >
        {children}
      </Button>
    );

    if (tooltip) {
      return (
        <Tooltip
          content={
            tooltip.shortcut ? (
              <span className="flex items-center gap-1.5">
                {tooltip.content}
                <kbd className="rounded bg-white/20 px-1 text-[10px]">{tooltip.shortcut}</kbd>
              </span>
            ) : (
              tooltip.content
            )
          }
          position={tooltip.side ?? 'top'}
        >
          {button}
        </Tooltip>
      );
    }

    return button;
  }
);
PromptInputButton.displayName = 'PromptInputButton';

/* ─── PromptInputSubmit ──────────────────────────────────────────── */

export interface PromptInputSubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  status?: PromptInputStatus;
}

/**
 * Identity of the icon a caller passed in, so the beUI Action Swap knows when
 * the slot's content actually changed. Element type (lucide displayName) is
 * the identity — the same icon re-rendered never replays the swap.
 */
const submitSwapKey = (children: React.ReactNode): string => {
  if (React.isValidElement(children)) {
    const type = children.type as { displayName?: string; name?: string } | string;
    if (typeof type === 'string') return type;
    return type.displayName ?? type.name ?? 'custom';
  }
  return 'custom';
};

export const PromptInputSubmit = React.forwardRef<HTMLButtonElement, PromptInputSubmitProps>(
  ({ className, status: statusProp, children, ...props }, ref) => {
    const context = React.useContext(PromptInputContext);
    const status = statusProp ?? context?.status ?? 'ready';
    const isActive = status === 'submitted' || status === 'streaming';

    let swapValue = children != null ? submitSwapKey(children) : isActive ? 'stop' : 'send';
    // The queue arrow is the same glyph as the send arrow — one slot identity,
    // so trading queue for send doesn't replay the swap between twin arrows.
    if (swapValue === 'ArrowUp' || swapValue === 'ArrowUpIcon') swapValue = 'send';

    return (
      <Button
        ref={ref}
        type={isActive ? 'button' : 'submit'}
        variant="default"
        size="icon"
        className={cn('h-8 w-8 shrink-0 rounded-lg', className)}
        {...props}
      >
        <ActionSwapIcon value={swapValue} className="h-4 w-4">
          {children ?? (isActive ? (
            <SquareIcon className="h-3.5 w-3.5 fill-current" />
          ) : (
            <ArrowUpIcon className="h-4 w-4" strokeWidth={2} />
          ))}
        </ActionSwapIcon>
      </Button>
    );
  }
);
PromptInputSubmit.displayName = 'PromptInputSubmit';

export { usePromptInput };
