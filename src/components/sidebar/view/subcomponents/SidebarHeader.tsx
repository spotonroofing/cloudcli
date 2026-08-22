import { Compass, FolderPlus, Hammer, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import {
  NumberTicker,
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

/**
 * One planner/worker live-run counter pill. Distinct colorways tell the two
 * apart at a glance (planner = primary silver-blue, worker = emerald, echoing
 * the running-view emerald); the label shimmers softly while the count is
 * nonzero and the digits roll through NumberTicker per the control laws.
 */
export function ActivityCounter({
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
    <span
      data-slot={`${kind}-counter`}
      data-count={count}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors duration-500',
        active
          ? kind === 'planner'
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-border/60 bg-muted/40 text-muted-foreground',
      )}
      title={`${label}: ${count}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span
        className={cn('truncate', active && TEXT_SHIMMER_CLASS_NAME)}
        style={active ? textShimmerStyle(2.5) : undefined}
      >
        {label}
      </span>
      <NumberTicker value={count} className="tabular-nums" />
    </span>
  );
}

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  /** Header action: new session in the scoped project. Null until a project is scoped. */
  onNewSession: (() => void) | null;
  onCollapseSidebar: () => void;
  /** Live planner-origin runs (origin planner or null — Willem's chats). */
  plannerRunningCount: number;
  /** Live worker-origin runs (direct, dispatch, external). */
  workerRunningCount: number;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onNewSession,
  onCollapseSidebar,
  plannerRunningCount,
  workerRunningCount,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : searchMode === 'running'
        ? t('search.runningPlaceholder', 'Search running sessions...')
        : t('projects.searchPlaceholder');
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);

  const segmentClass = (mode: SidebarSearchMode) => cn(
    'flex min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-normal transition-all',
    searchMode === mode
      ? 'bg-background shadow-sm text-foreground'
      : 'text-muted-foreground hover:text-foreground',
  );

  return (
    <div className="flex-shrink-0">
      <div
        className="px-3 pb-2 pt-3"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center gap-2">
          {/* Equal-width segmented control inside the top button bar */}
          {showSearchTools && (
            <div className="flex min-w-0 flex-1 rounded-lg bg-muted/50 p-0.5">
              <button
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                className={segmentClass('projects')}
              >
                <span className="truncate">{t('search.modeProjects', 'Projects')}</span>
              </button>
              <button
                onClick={() => onSearchModeChange('conversations')}
                aria-pressed={searchMode === 'conversations'}
                className={segmentClass('conversations')}
              >
                <span className="truncate">{t('search.modeConversations')}</span>
              </button>
              {/* Running view is a mobile-only control; desktop is chat-scoped */}
              {isMobile && (
                <button
                  onClick={() => onSearchModeChange('running')}
                  aria-pressed={searchMode === 'running'}
                  className={segmentClass('running')}
                >
                  <span className="truncate">{t('search.modeRunning', 'Running')}</span>
                  {runningSessionsCount > 0 && (
                    <span className="flex h-3.5 min-w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-semibold leading-none text-white">
                      {runningBadgeText}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => onSearchModeChange('archived')}
                aria-pressed={searchMode === 'archived'}
                className={segmentClass('archived')}
              >
                <span className="truncate">{t('archived.title', 'Archive')}</span>
              </button>
            </div>
          )}
          <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onNewSession ?? undefined}
              disabled={!onNewSession}
              title={t('sessions.newSession')}
              aria-label={t('sessions.newSession')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {/* Create project is a mobile-only control; desktop is pinned to one project */}
            {isMobile && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                onClick={onCreateProject}
                title={t('projects.createProject', 'Create project')}
                aria-label={t('projects.createProject', 'Create project')}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isMobile && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                onClick={onCollapseSidebar}
                title={t('tooltips.hideSidebar')}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Search bar */}
        {showSearchTools && (
          <div className="mt-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-9 rounded-lg border-0 pl-9 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active-session counters: a new slim row below the search bar, so
            the existing top-bar layout stays untouched. */}
        {showSearchTools && (
          <div className="mt-2 flex items-center gap-1.5" data-slot="activity-counters">
            <style>{TEXT_SHIMMER_KEYFRAMES}</style>
            <ActivityCounter
              kind="planner"
              count={plannerRunningCount}
              label={t('running.plannerCounter', 'Planner')}
            />
            <ActivityCounter
              kind="worker"
              count={workerRunningCount}
              label={t('running.workerCounter', 'Worker')}
            />
          </div>
        )}
      </div>

      <div className="nav-divider" />
    </div>
  );
}
