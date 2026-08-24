import { Compass, Hammer, Settings, PanelLeftOpen, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import { NumberTicker } from '../../../../shared/view/beui';
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

/**
 * Rail slice of the bottom activity bar (ui8 phase 3): icon left, rolling
 * number right, rectangular on the app radius, breathing while nonzero.
 */
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
        'flex w-9 items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-1.5 py-1 text-[10px] font-medium',
        active
          ? kind === 'planner'
            ? 'animate-counter-breathe text-primary'
            : 'animate-counter-breathe text-emerald-700 dark:text-emerald-300'
          : 'text-muted-foreground',
      )}
      title={`${label}: ${count}`}
      aria-label={`${label}: ${count}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <NumberTicker value={count} className="tabular-nums leading-none" />
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
  const showCounters = plannerRunningCount > 0 || workerRunningCount > 0;

  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3 backdrop-blur-sm">
      {/* Expand button */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <PanelLeftOpen className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

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

      {/* Planner/worker live-run counters — the rail's slice of the expanded
          footer's activity bar, pinned to the rail bottom above Settings and
          hidden entirely while nothing runs. */}
      {showCounters && (
        <div className="mt-auto flex flex-col items-center gap-1" data-slot="rail-activity-counters">
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
        </div>
      )}

      {/* Settings — pinned to the rail bottom, matching the expanded footer */}
      <button
        onClick={onShowSettings}
        className={cn(
          'group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80',
          !showCounters && 'mt-auto',
        )}
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
    </div>
  );
}
