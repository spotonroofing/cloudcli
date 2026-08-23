import { Compass, Hammer, Settings, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';

import { NumberTicker } from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';

type SidebarFooterProps = {
  restartRequired: boolean;
  onShowSettings: () => void;
  /** Live planner-origin runs (origin planner or null — Willem's chats). */
  plannerRunningCount: number;
  /** Live worker-origin runs (direct, dispatch, external). */
  workerRunningCount: number;
  t: TFunction;
};

/**
 * One column of the bottom activity bar (ui8 phase 3): icon, label, rolling
 * count on the planner/worker colorway. The column breathes (opacity/filter
 * swell) while its count is nonzero; the whole bar hides when both are zero.
 */
function ActivityCounterColumn({
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
      data-slot={`${kind}-counter`}
      data-count={count}
      className={cn(
        'flex min-w-0 items-center justify-center gap-1.5 py-2 text-[11px] font-medium',
        active
          ? kind === 'planner'
            ? 'animate-counter-breathe text-primary'
            : 'animate-counter-breathe text-emerald-700 dark:text-emerald-300'
          : 'text-muted-foreground',
      )}
      title={`${label}: ${count}`}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      <NumberTicker value={count} className="tabular-nums" />
    </div>
  );
}

export default function SidebarFooter({
  restartRequired,
  onShowSettings,
  plannerRunningCount,
  workerRunningCount,
  t,
}: SidebarFooterProps) {
  const showCounterBar = plannerRunningCount > 0 || workerRunningCount > 0;

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Live-run counter bar (ui8 phase 3): one full-width two-column
          rectangle on the app radius — planner left, worker right — pinned to
          the sidebar bottom. Hidden entirely while nothing runs. */}
      {showCounterBar && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <div
              data-slot="activity-counter-bar"
              className="grid grid-cols-2 divide-x divide-border/60 rounded-lg border border-border/60 bg-muted/30"
            >
              <ActivityCounterColumn
                kind="planner"
                count={plannerRunningCount}
                label={t('running.plannerCounter', 'Planner')}
              />
              <ActivityCounterColumn
                kind="worker"
                count={workerRunningCount}
                label={t('running.workerCounter', 'Worker')}
              />
            </div>
          </div>
        </>
      )}

      {/* Settings pinned to the bottom, one treatment on every form factor */}
      <div className="nav-divider" />
      <div className="px-2 py-1.5">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>
    </div>
  );
}
