import { Compass, Hammer, Settings, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  NumberTicker,
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  restartRequired: boolean;
  /** Live planner-origin runs (origin planner or null — Willem's chats). */
  plannerRunningCount: number;
  /** Live worker-origin runs (direct, dispatch, external). */
  workerRunningCount: number;
  t: TFunction;
};

/** Rail-sized planner/worker counter: icon over rolling count, shimmering while nonzero. */
function RailCounter({
  kind,
  count,
  label,
}: {
  kind: 'planner' | 'worker';
  count: number;
  label: string;
}) {
  const Icon = kind === 'planner' ? Compass : Hammer;
  const active = count > 0;

  return (
    <div
      data-slot={`${kind}-rail-counter`}
      data-count={count}
      className={cn(
        'flex w-8 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors duration-500',
        active
          ? kind === 'planner'
            ? 'bg-primary/10 text-primary'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'text-muted-foreground/70',
      )}
      title={`${label}: ${count}`}
      aria-label={`${label}: ${count}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span
        className={cn('text-[10px] font-medium leading-none', active && TEXT_SHIMMER_CLASS_NAME)}
        style={active ? textShimmerStyle(2.5) : undefined}
      >
        <NumberTicker value={count} className="tabular-nums" />
      </span>
    </div>
  );
}

export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  restartRequired,
  plannerRunningCount,
  workerRunningCount,
  t,
}: SidebarCollapsedProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3 backdrop-blur-sm">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      <div className="nav-divider my-1 w-6" />

      {/* Planner/worker live-run counters — the rail's slice of the expanded
          header's activity counters, same shimmer-while-nonzero treatment. */}
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <RailCounter
        kind="planner"
        count={plannerRunningCount}
        label={t('running.plannerCounter', 'Planner')}
      />
      <RailCounter
        kind="worker"
        count={workerRunningCount}
        label={t('running.workerCounter', 'Worker')}
      />

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        </div>
      )}

      {/* Settings — pinned to the rail bottom, matching the expanded footer */}
      <button
        onClick={onShowSettings}
        className="group mt-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </div>
  );
}
