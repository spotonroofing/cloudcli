import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { MarqueeLabel } from '../../../../shared/view/beui';

import ChatRowMenu, { WATCHDOG_WAKE_TARGET_CHANGED_EVENT, type ChatRowMenuProps } from './ChatRowMenu';
import ResponseSignal, { type ActivityKinds } from './ResponseSignal';

type ChatRowProps = {
  href: string;
  /** Bounce-dot destination key (the session id). */
  bounceKey: string;
  title: string;
  /** Second-line lead (the owning project's name on the Chats tab). */
  subtitle?: string | null;
  subtitleItalic?: boolean;
  /** ISO timestamp for the <time> element. */
  timestamp?: string | null;
  /** Formatted relative time, bottom-left under the title. */
  age: string;
  isSelected: boolean;
  onSelect: () => void;
  /** Renders inside the row's relative box (the activity border beam). */
  overlay?: ReactNode;
  responseKinds?: ActivityKinds;
  /** This chat is the owning project's fallback watchdog wake destination. */
  isWatchdogWakeTarget?: boolean;
  /** Saves an inline rename; the row owns the editing state. */
  onRename: (name: string) => void | Promise<void>;
  menu: Omit<ChatRowMenuProps, 'onRename'>;
  /** Externally-armed rename (the mobile sheet's Rename item). */
  dataTestId?: string;
};

/**
 * The one chat-row anatomy (ui9 B5), shared by the Projects tab and the
 * Chats tab: two-line row — title over relative time bottom-left (with an
 * optional project-name lead) — and a trailing control that shows the
 * chevron arrow at rest and morphs into the three-dots menu trigger on
 * hover. Selection stays an ink shift; the bounce dot marks the open chat.
 */
export default function ChatRow({
  href,
  bounceKey,
  title,
  subtitle = null,
  subtitleItalic = false,
  timestamp = null,
  age,
  isSelected,
  onSelect,
  overlay,
  responseKinds = { planner: false, worker: false },
  isWatchdogWakeTarget = false,
  onRename,
  menu,
  dataTestId,
}: ChatRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  // Hover marquee (pre-ui12 scan, restored ui13 job 3): mouse enter/leave is
  // effectively fine-pointer only — touch taps navigate before hover matters.
  const [rowHovered, setRowHovered] = useState(false);
  const [wakeTarget, setWakeTarget] = useState(isWatchdogWakeTarget);

  useEffect(() => {
    setWakeTarget(isWatchdogWakeTarget);
  }, [isWatchdogWakeTarget]);

  useEffect(() => {
    const handleWakeTargetChanged = (event: Event) => {
      const targetSessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (targetSessionId) {
        setWakeTarget(targetSessionId === menu.sessionId);
      }
    };
    window.addEventListener(WATCHDOG_WAKE_TARGET_CHANGED_EVENT, handleWakeTargetChanged);
    return () => window.removeEventListener(WATCHDOG_WAKE_TARGET_CHANGED_EVENT, handleWakeTargetChanged);
  }, [menu.sessionId]);

  const startRename = () => {
    setEditingName(title);
    setIsEditing(true);
  };

  const saveRename = () => {
    setIsEditing(false);
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== title) {
      void onRename(trimmed);
    }
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (isEditing) return;
    onSelect();
  };

  return (
    <a
      href={href}
      data-bounce-key={bounceKey}
      data-testid={dataTestId}
      data-slot="chat-row"
      onClick={handleClick}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      className={cn(
        'group relative flex min-w-0 items-center gap-2 rounded-lg py-2 pl-3 pr-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {overlay}
      {isEditing ? (
        <span className="flex min-w-0 flex-1 items-center gap-1" onClick={(event) => event.preventDefault()}>
          <input
            spellCheck={false}
            autoCorrect="off"
            type="text"
            value={editingName}
            onChange={(event) => setEditingName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') saveRename();
              else if (event.key === 'Escape') setIsEditing(false);
            }}
            onClick={(event) => event.stopPropagation()}
            className="w-full min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-primary md:text-xs"
            autoFocus
          />
          <button
            type="button"
            className="touch-hit relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              saveRename();
            }}
            aria-label="Save name"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="touch-hit relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              setIsEditing(false);
            }}
            aria-label="Cancel rename"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <MarqueeLabel active={rowHovered} className="text-[13px] font-normal leading-4">
            {title}
          </MarqueeLabel>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
            {subtitle && (
              <>
                <span className={cn('truncate', subtitleItalic && 'italic text-muted-foreground/70')}>
                  {subtitle}
                </span>
                {age && <span className="flex-shrink-0 text-muted-foreground/40">·</span>}
              </>
            )}
            {age && (
              <time className="flex-shrink-0 tabular-nums" dateTime={timestamp ?? undefined}>
                {age}
              </time>
            )}
          </span>
        </span>
      )}

      {wakeTarget && (
        <span
          data-slot="watchdog-wake-target-mark"
          className="hidden h-4 flex-shrink-0 items-center rounded-sm border border-border/70 px-1 font-mono text-[9px] leading-none tracking-tight text-muted-foreground/70 md:group-hover:inline-flex"
        >
          wake
        </span>
      )}

      <ResponseSignal kinds={responseKinds} />

      {/* Trailing control: the arrow is the resting state; on row hover it
          morphs into the three-dots trigger for the shared menu. */}
      <span
        data-slot="chat-row-control"
        className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center"
        // A click on the control area must never navigate the row.
        onClick={(event) => event.preventDefault()}
      >
        <ChevronRight
          data-slot="chat-row-arrow"
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground/40 transition-all duration-150',
            'md:group-hover:translate-x-0.5 md:group-hover:scale-50 md:group-hover:opacity-0',
            // Touch has no hover: the dots trigger is always visible there,
            // so the arrow yields its seat below md.
            'max-md:hidden',
          )}
        />
        <ChatRowMenu {...menu} isWatchdogWakeTarget={wakeTarget} onRename={startRename} />
      </span>
    </a>
  );
}
