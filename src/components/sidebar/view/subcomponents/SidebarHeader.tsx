import { Archive, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
import { motion } from 'motion/react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { TABS_INDICATOR_SPRING } from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

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
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : t('projects.searchPlaceholder');

  const segmentClass = (mode: SidebarSearchMode) => cn(
    'touch-hit relative flex h-7 w-9 items-center justify-center rounded-md transition-colors',
    searchMode === mode ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
  );

  // The active-segment plate glides between triggers on the shared tabs
  // spring (ui9 B5) instead of jumping; labels sit above it.
  const segmentIndicator = (mode: SidebarSearchMode) => searchMode === mode && (
    <motion.span
      layoutId="sidebar-segment-indicator"
      data-slot="sidebar-segment-indicator"
      transition={TABS_INDICATOR_SPRING}
      className="absolute inset-0 rounded-md bg-background shadow-sm"
      aria-hidden="true"
    />
  );

  return (
    <div className="flex-shrink-0">
      <div
        className="px-3 pb-2 pt-3"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center gap-2">
          {/* Left-aligned icon tabs (ui13 job 5): folder, chat bubble, archive
              box — icon-only controls, so tooltips are allowed here. */}
          {showSearchTools && (
            <div className="flex w-fit flex-shrink-0 rounded-lg bg-muted/50 p-0.5">
              <button
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                aria-label={t('search.modeProjects', 'Projects')}
                title={t('search.modeProjects', 'Projects')}
                className={segmentClass('projects')}
              >
                {segmentIndicator('projects')}
                <Folder className="relative h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onSearchModeChange('conversations')}
                aria-pressed={searchMode === 'conversations'}
                aria-label={t('search.modeConversations')}
                title={t('search.modeConversations')}
                className={segmentClass('conversations')}
              >
                {segmentIndicator('conversations')}
                <MessageSquare className="relative h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onSearchModeChange('archived')}
                aria-pressed={searchMode === 'archived'}
                aria-label={t('archived.title', 'Archive')}
                title={t('archived.title', 'Archive')}
                className={segmentClass('archived')}
              >
                {segmentIndicator('archived')}
                <Archive className="relative h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">
            {/* Refresh is desktop-only; mobile refreshes by pulling the list down */}
            {!isMobile && (
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
            )}
            <Button
              variant="ghost"
              size="sm"
              className="touch-hit relative h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
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
                className="touch-hit relative h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
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
                className="nav-search-input h-9 rounded-lg border-0 pl-9 pr-9 text-base transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="touch-hit absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="nav-divider" />
    </div>
  );
}
