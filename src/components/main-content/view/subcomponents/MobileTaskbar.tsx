import { useEffect } from 'react';

import type { AppTab } from '../../../../types/app';
import { cn } from '../../../../lib/utils';

/** Segments the phone taskbar can carry; planner and worker are always there. */
export type TaskbarSegmentId = 'planner' | 'worker' | 'files' | 'git' | 'shell';

/** Tool windows the window selector opens and closes as extra segments. */
export type TaskbarWindowId = 'files' | 'git' | 'shell';

export type TaskbarSegment = {
  id: TaskbarSegmentId;
  label: string;
  /** The segment's window is the one filling the screen. */
  active: boolean;
};

export type TaskbarState = {
  /** Standalone chats have no worker of their own, so they get no taskbar. */
  workerAvailable: boolean;
  /** Tool windows opened from the window selector. */
  openWindows: Record<TaskbarWindowId, boolean>;
  activeTab: AppTab;
  /** The shell has taken the active chat pane's place. */
  shellActive: boolean;
};

/** Short labels: five segments still have to read at 390px. */
const SEGMENT_LABELS: Record<TaskbarSegmentId, string> = {
  planner: 'Planner',
  worker: 'Worker',
  files: 'Files',
  git: 'Git',
  shell: 'Shell',
};

/**
 * The phone's whole navigation (ui17 job 8): Planner and Worker always, then
 * one segment per tool window the user opened, in a fixed order so a window
 * opening never reshuffles the ones already there. Two segments split the bar
 * 50/50, three in thirds — the bar itself is the equal-width flex row.
 */
export function taskbarSegments(state: TaskbarState): TaskbarSegment[] {
  if (!state.workerAvailable) {
    return [];
  }
  const onChatPane = state.activeTab === 'chat' || state.activeTab === 'worker';
  const shellShown = state.shellActive && onChatPane;
  const segments: TaskbarSegment[] = [
    { id: 'planner', label: SEGMENT_LABELS.planner, active: !shellShown && state.activeTab === 'chat' },
    { id: 'worker', label: SEGMENT_LABELS.worker, active: !shellShown && state.activeTab === 'worker' },
  ];
  // A window the app routed to (the palette's Open file) carries its segment
  // even before the selector has been touched, so the view is always reachable.
  if (state.openWindows.files || state.activeTab === 'files') {
    segments.push({ id: 'files', label: SEGMENT_LABELS.files, active: state.activeTab === 'files' });
  }
  if (state.openWindows.git || state.activeTab === 'git') {
    segments.push({ id: 'git', label: SEGMENT_LABELS.git, active: state.activeTab === 'git' });
  }
  if (state.openWindows.shell) {
    segments.push({ id: 'shell', label: SEGMENT_LABELS.shell, active: shellShown });
  }
  return segments;
}

type MobileTaskbarProps = {
  segments: TaskbarSegment[];
  /** A composer has focus, so the keyboard owns the bottom of the screen. */
  hidden: boolean;
  onSelect: (id: TaskbarSegmentId) => void;
};

/**
 * The bottom taskbar (ui17 job 8), phone viewports only: wide equal-width
 * label segments across the bottom of the app shell, above the home
 * indicator, marked in the app's monochrome — the selected segment carries
 * the same ink shift and accent wash the sidebar taskbar uses, never a color.
 * Focusing a composer slides it away and collapses its slot on the drawer
 * ramp, so the keyboard never rises against a dead band.
 */
export default function MobileTaskbar({ segments, hidden, onSelect }: MobileTaskbarProps) {
  // Phone chrome that pins itself to the bottom of the screen (the terminal's
  // key bar) reads this to clear the bar instead of covering it.
  const showing = segments.length > 0 && !hidden;
  useEffect(() => {
    const root = document.documentElement;
    if (showing) {
      // The bottom-pinned chrome pads the home-indicator inset itself, so the
      // offset carries only the bar above it.
      root.style.setProperty(
        '--mobile-taskbar-offset',
        'calc(var(--mobile-taskbar-height) - env(safe-area-inset-bottom, 0px))',
      );
    } else {
      root.style.removeProperty('--mobile-taskbar-offset');
    }
    return () => {
      root.style.removeProperty('--mobile-taskbar-offset');
    };
  }, [showing]);

  if (segments.length === 0) {
    return null;
  }
  return (
    <div
      data-slot="mobile-taskbar-slot"
      data-hidden={hidden ? 'true' : 'false'}
      className="mobile-taskbar-slot flex-shrink-0 overflow-hidden"
    >
      <div
        data-slot="mobile-taskbar"
        data-segments={segments.length}
        className={cn(
          'mobile-taskbar flex w-full items-stretch gap-1 border-t border-border/50 bg-background px-1 pt-1',
          'transition-transform duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none',
          hidden && 'translate-y-full',
        )}
      >
        {segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            data-slot="mobile-taskbar-segment"
            data-segment={segment.id}
            data-active={segment.active ? 'true' : 'false'}
            aria-current={segment.active ? 'page' : undefined}
            tabIndex={hidden ? -1 : undefined}
            onClick={() => onSelect(segment.id)}
            className={cn(
              'flex min-w-0 flex-1 basis-0 items-center justify-center rounded-lg px-1 text-[11px] font-medium',
              'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              segment.active ? 'bg-accent/60 text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="truncate">{segment.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
