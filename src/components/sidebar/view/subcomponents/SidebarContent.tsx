import { useRef, useState, type ReactNode } from 'react';
import { Archive, Folder, Loader2, MessageSquare, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ScrollArea, Skeleton } from '../../../../shared/view/ui';
import { Loader } from '../../../../shared/view/beui/Loader';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { LLMProvider, Project } from '../../../../types/app';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { ActiveSessionRow, ArchivedProjectListItem, ArchivedSessionListItem, RecentConversationListItem, ResponseIndicatorInfo, SidebarSearchMode } from '../../types/types';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';
import { formatCompactAge, getAllSessions } from '../../utils/utils';
import Settings from '../../../settings/view/Settings';

import MemorySurface from './MemorySurface';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarSurface from './SidebarSurface';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarRecentConversations from './SidebarRecentConversations';

function HighlightedSnippet({ snippet, highlights }: { snippet: string; highlights: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of highlights) {
    if (h.start > cursor) {
      parts.push(snippet.slice(cursor, h.start));
    }
    parts.push(
      <mark key={h.start} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-800">
        {snippet.slice(h.start, h.end)}
      </mark>
    );
    cursor = h.end;
  }
  if (cursor < snippet.length) {
    parts.push(snippet.slice(cursor));
  }
  return (
    <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
      {parts}
    </span>
  );
}

type ArchivedSessionGroup = {
  key: string;
  projectId: string | null;
  projectDisplayName: string;
  projectPath: string | null;
  isProjectArchived: boolean;
  sessions: ArchivedSessionListItem[];
  latestActivity: string | null;
};

/**
 * Groups archived sessions by project metadata so the archive view preserves
 * the same mental model as the active sidebar: projects first, then sessions.
 */
function groupArchivedSessionsByProject(sessions: ArchivedSessionListItem[]): ArchivedSessionGroup[] {
  const groups = new Map<string, ArchivedSessionGroup>();

  for (const session of sessions) {
    const key = session.projectId ?? session.projectPath ?? `session:${session.sessionId}`;
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.sessions.push(session);
      if (!existingGroup.latestActivity || (session.lastActivity && session.lastActivity > existingGroup.latestActivity)) {
        existingGroup.latestActivity = session.lastActivity;
      }
      continue;
    }

    groups.set(key, {
      key,
      projectId: session.projectId,
      projectDisplayName: session.projectDisplayName,
      projectPath: session.projectPath,
      isProjectArchived: session.isProjectArchived,
      sessions: [session],
      latestActivity: session.lastActivity,
    });
  }

  return [...groups.values()].sort((groupA, groupB) => {
    const a = groupA.latestActivity ?? '';
    const b = groupB.latestActivity ?? '';
    return b.localeCompare(a);
  });
}

type SidebarContentProps = {
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  runningSessionsCount: number;
  plannerRunningCount: number;
  workerRunningCount: number;
  responseIndicators: ReadonlyMap<string, ResponseIndicatorInfo>;
  onSessionViewed: (sessionId: string) => void;
  activeSessionRows: ActiveSessionRow[];
  onOpenActiveSession: (row: ActiveSessionRow) => void;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  recentConversations: RecentConversationListItem[];
  recentConversationsTotal: number;
  recentConversationsHasMore: boolean;
  isRecentConversationsLoading: boolean;
  isLoadingMoreRecentConversations: boolean;
  recentConversationsError: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onRestoreArchivedProject: (projectId: string) => void;
  onLoadMoreRecentConversations: () => void;
  onRetryRecentConversations: () => void;
  onRenameConversation: (sessionId: string, name: string) => void;
  onMoveConversationToProject: (sessionId: string, projectPath: string | null) => void;
  onArchiveConversation: (sessionId: string) => void;
  onDeleteConversation: (
    projectId: string | null,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onNewStandaloneChat: () => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  // Conversation result clicks pass back the DB projectId (or null when the
  // server couldn't resolve it). Consumers must handle the null case.
  onConversationResultClick: (projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  onClose?: () => void;
  restartRequired: boolean;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isMobile,
  isLoading,
  projects,
  runningSessionsCount,
  plannerRunningCount,
  workerRunningCount,
  responseIndicators,
  onSessionViewed,
  activeSessionRows,
  onOpenActiveSession,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  recentConversations,
  recentConversationsTotal,
  recentConversationsHasMore,
  isRecentConversationsLoading,
  isLoadingMoreRecentConversations,
  recentConversationsError,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  conversationResults,
  isSearching,
  searchProgress,
  onRestoreArchivedProject,
  onLoadMoreRecentConversations,
  onRetryRecentConversations,
  onRenameConversation,
  onMoveConversationToProject,
  onArchiveConversation,
  onDeleteConversation,
  onNewStandaloneChat,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  onClose,
  restartRequired,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;
  const hasSearchResults = Boolean(
    conversationResults
    && (conversationResults.titleResults.length > 0 || conversationResults.results.length > 0),
  );
  const groupedArchivedSessions = groupArchivedSessionsByProject(archivedSessions);
  const visibleArchivedItemsCount = archivedProjects.length + archivedSessions.length;
  const isRenamingOnMobile = isMobile && Boolean(projectListProps.editingProject);
  // Desktop is pinned to one project (phase 3), so the header's New Session
  // button always targets the current scoped project.
  const scopedProject = projectListProps.selectedProject;

  // Full-sidebar surfaces (ui13 job 5): Settings (app-owned open state) and
  // Memory (local) slide up over the content region above the taskbar. One
  // surface at a time; opening a footer drawer closes them too.
  const [showMemory, setShowMemory] = useState(false);
  const closeSurfaces = () => {
    setShowMemory(false);
    if (showSettings) onCloseSettings();
  };
  const toggleSettings = () => {
    if (showSettings) {
      onCloseSettings();
    } else {
      setShowMemory(false);
      onShowSettings();
    }
  };
  const toggleMemory = () => {
    if (!showMemory && showSettings) onCloseSettings();
    setShowMemory((current) => !current);
  };

  // Mobile refreshes by pulling the list down (the refresh button is
  // desktop-only); the indicator row above the list grows with the pull.
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const pullToRefresh = usePullToRefresh({
    scrollRef: scrollViewportRef,
    onRefresh,
    isRefreshing,
    enabled: isMobile,
  });

  return (
    <div className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-72 md:select-none">
      {/* Content region the full-sidebar surfaces cover: everything above the
          footer taskbar, so the taskbar icons stay reachable to close them. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <SidebarHeader
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        runningSessionsCount={runningSessionsCount}
        archivedSessionsCount={archivedSessionsCount}
        isArchivedSessionsLoading={isArchivedSessionsLoading}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onNewSession={scopedProject ? () => projectListProps.onNewSession(scopedProject) : null}
        onCollapseSidebar={onCollapseSidebar}
        onClose={onClose}
        t={t}
      />

      {isMobile && (
        <div
          aria-hidden={pullToRefresh.indicatorHeight === 0}
          className={`flex flex-shrink-0 items-end justify-center overflow-hidden ${
            pullToRefresh.pulling ? '' : 'transition-[height] duration-200 ease-out'
          }`}
          style={{ height: `${pullToRefresh.indicatorHeight}px` }}
          data-slot="pull-to-refresh"
          data-armed={pullToRefresh.armed || pullToRefresh.holding ? 'true' : undefined}
        >
          <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <RefreshCw
              className={`h-3.5 w-3.5 ${pullToRefresh.holding ? 'animate-spin' : ''}`}
              style={pullToRefresh.holding ? undefined : {
                transform: `rotate(${pullToRefresh.pullProgress * 270}deg)`,
                opacity: 0.35 + pullToRefresh.pullProgress * 0.65,
              }}
            />
          </span>
        </div>
      )}
      {/* Horizontal padding lives on the viewport (with a transparent right
          border) so the 4px thumb sits centered in the sidebar's right gutter
          instead of hugging the rows. */}
      <ScrollArea
        ref={scrollViewportRef}
        className="flex-1 overscroll-contain py-2"
        viewportClassName="sidebar-scroll-viewport overscroll-contain px-1.5"
      >
        {showConversationSearch ? (
          isSearching && !conversationResults ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Loader variant="dot-matrix" size={24} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
              {searchProgress && (
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {t('search.projectsScanned', { count: searchProgress.scannedProjects })}/{searchProgress.totalProjects}
                </p>
              )}
            </div>
          ) : !isSearching && conversationResults && !hasSearchResults ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('search.noResults')}</h3>
              <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
            </div>
          ) : conversationResults && (hasSearchResults || isSearching) ? (
            <div className="space-y-4 px-2" aria-live="polite">
              {conversationResults.titleResults.length > 0 && (
                <section className="space-y-1" aria-labelledby="session-title-results-heading">
                  <div className="flex items-center justify-between px-1 py-0.5">
                    <h3
                      id="session-title-results-heading"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      {t('search.sessionTitles', 'Session')}
                    </h3>
                    <span className="text-[10px] tabular-nums text-muted-foreground/70">
                      {conversationResults.titleResults.length}
                    </span>
                  </div>

                  {conversationResults.titleResults.map((session) => {
                    const age = formatCompactAge(session.lastActivity, projectListProps.currentTime);

                    return (
                      <button
                        key={`${session.provider}-${session.sessionId}`}
                        type="button"
                        className="group flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
                        onClick={() => onConversationResultClick(
                          session.projectId,
                          session.sessionId,
                          session.provider,
                        )}
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60">
                          <LLMProviderLogo provider={session.provider} className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-normal leading-4 text-foreground">
                            {session.sessionTitle}
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                            <span className="truncate">{session.projectDisplayName}</span>
                            {age && (
                              <>
                                <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                                <time className="flex-shrink-0 tabular-nums" dateTime={session.lastActivity ?? undefined}>
                                  {age}
                                </time>
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              )}

              {(conversationResults.results.length > 0 || isSearching) && (
                <section className="space-y-3" aria-labelledby="conversation-content-results-heading">
                  <div className="flex items-center justify-between px-1 py-0.5">
                    <h3
                      id="conversation-content-results-heading"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      {t('search.conversationContents', 'Conversation contents')}
                    </h3>
                    <span className="text-[10px] tabular-nums text-muted-foreground/70">
                      {t('search.matches', { count: conversationResults.totalMatches })}
                    </span>
                  </div>

                  {isSearching && searchProgress && (
                    <div className="space-y-1.5 px-1">
                      <div className="flex items-center justify-end gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <p className="text-[10px] text-muted-foreground/60">
                          {searchProgress.scannedProjects}/{searchProgress.totalProjects}
                        </p>
                      </div>
                      <div className="h-0.5 overflow-hidden rounded-sm bg-muted">
                        <div
                          className="h-full rounded-sm bg-primary/60 transition-all duration-300"
                          style={{
                            width: `${searchProgress.totalProjects > 0
                              ? Math.round((searchProgress.scannedProjects / searchProgress.totalProjects) * 100)
                              : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {conversationResults.results.map((projectResult) => (
                    <div key={projectResult.projectName} className="space-y-1">
                      <div className="flex items-center gap-1.5 px-1 py-1">
                        <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-normal text-foreground">
                          {projectResult.projectDisplayName}
                        </span>
                      </div>
                      {projectResult.sessions.map((session) => (
                        <button
                          key={`${projectResult.projectId ?? projectResult.projectName}-${session.sessionId}`}
                          className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
                          onClick={() => onConversationResultClick(
                            // Pass the DB projectId (preferred) so the parent can
                            // cross-reference with the loaded projects list.
                            projectResult.projectId,
                            session.sessionId,
                            session.provider || session.matches[0]?.provider || 'claude',
                            session.matches[0]?.timestamp,
                            session.matches[0]?.snippet
                          )}
                        >
                          <div className="mb-1 flex items-center gap-1.5">
                            <MessageSquare className="h-3 w-3 flex-shrink-0 text-primary" />
                            <span className="truncate text-xs font-normal text-foreground">
                              {session.sessionSummary}
                            </span>
                            {session.provider && session.provider !== 'claude' && (
                              <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                                {session.provider}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1 pl-4">
                            {session.matches.map((match, idx) => (
                              <div key={idx} className="flex items-start gap-1">
                                <span className="mt-0.5 flex-shrink-0 text-[10px] font-normal uppercase text-muted-foreground/60">
                                  {match.role === 'user' ? 'U' : 'A'}
                                </span>
                                <HighlightedSnippet
                                  snippet={match.snippet}
                                  highlights={match.highlights}
                                />
                              </div>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </section>
              )}
            </div>
          ) : null
        ) : searchMode === 'conversations' ? (
          <SidebarRecentConversations
            conversations={recentConversations}
            total={recentConversationsTotal}
            hasMore={recentConversationsHasMore}
            isLoading={isRecentConversationsLoading}
            isLoadingMore={isLoadingMoreRecentConversations}
            hasError={recentConversationsError}
            selectedSession={projectListProps.selectedSession}
            currentTime={projectListProps.currentTime}
            projects={projects}
            responseIndicators={responseIndicators}
            onSessionViewed={onSessionViewed}
            onConversationSelect={onConversationResultClick}
            onLoadMore={onLoadMoreRecentConversations}
            onRetry={onRetryRecentConversations}
            onRenameConversation={onRenameConversation}
            onMoveConversationToProject={onMoveConversationToProject}
            onArchiveConversation={onArchiveConversation}
            onDeleteConversation={onDeleteConversation}
            onNewStandaloneChat={onNewStandaloneChat}
            t={t}
          />
        ) : searchMode === 'archived' ? (
          isArchivedSessionsLoading ? (
            <div className="space-y-2 px-2 py-1" aria-live="polite" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="rounded-lg border border-border/50 bg-card/40 p-3">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3 w-2/3 rounded-sm" />
                      <Skeleton className="h-2.5 w-5/6 rounded-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : archivedProjects.length === 0 && groupedArchivedSessions.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                <Archive className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {archivedSessionsCount > 0
                  ? t('archived.noMatchingSessions', 'No matching archived items')
                  : t('archived.emptyTitle', 'No archived items')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {archivedSessionsCount > 0
                  ? t('archived.tryDifferentSearch', 'Try a different search term.')
                  : t('archived.emptyDescription', 'Archived workspaces and sessions will appear here when you hide them from the active list.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 px-2 pb-3">
              <div className="flex items-center justify-between px-1 pb-0.5 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                    <Archive className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h2 className="text-xs font-medium leading-none text-foreground">
                      {t('archived.title', 'Archive')}
                    </h2>
                    <p className="mt-1 text-[10px] leading-none text-muted-foreground">
                      {t('archived.restoreHint', 'Restore items whenever you need them')}
                    </p>
                  </div>
                </div>
                <span
                  className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                >
                  {visibleArchivedItemsCount !== archivedSessionsCount
                    ? `${visibleArchivedItemsCount}/${archivedSessionsCount}`
                    : archivedSessionsCount}
                </span>
              </div>
              {archivedProjects.map((project) => {
                const projectSessions = getAllSessions(project);

                return (
                  <section
                    key={project.projectId}
                    className="group/archive overflow-hidden rounded-lg border border-border/70 bg-card/45 shadow-[0_1px_0_hsl(var(--border)/0.2)] transition-colors hover:border-border"
                  >
                    <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground">
                        <Folder className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-[13px] font-medium text-foreground">
                            {project.displayName}
                          </h3>
                          {projectSessions.length > 0 && (
                            <span className="flex-shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                              {projectSessions.length}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                          {project.fullPath}
                        </p>
                      </div>
                      <button
                        className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-600 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-400"
                        onClick={() => onRestoreArchivedProject(project.projectId)}
                        title={t('archived.restoreProject', 'Restore workspace')}
                        aria-label={`${t('archived.restoreProject', 'Restore workspace')}: ${project.displayName}`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('archived.restoreAction', 'Restore')}
                      </button>
                    </div>
                    {projectSessions.length > 0 && (
                      <div className="border-t border-border/45 bg-muted/[0.08]">
                        {projectSessions.map((session) => (
                          <button
                            key={String(session.id)}
                            className="flex w-full items-center gap-2.5 border-b border-border/35 px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => onArchivedSessionClick({
                              sessionId: String(session.id),
                              provider: session.__provider,
                              projectId: project.projectId,
                              projectPath: project.fullPath,
                              projectDisplayName: project.displayName,
                              sessionTitle:
                                (typeof session.summary === 'string' && session.summary.trim().length > 0
                                  ? session.summary
                                  : typeof session.name === 'string' && session.name.trim().length > 0
                                    ? session.name
                                    : String(session.id)),
                              createdAt: typeof session.created_at === 'string' ? session.created_at : null,
                              updatedAt: typeof session.updated_at === 'string' ? session.updated_at : null,
                              lastActivity:
                                typeof session.lastActivity === 'string'
                                  ? session.lastActivity
                                  : typeof session.updated_at === 'string'
                                    ? session.updated_at
                                    : typeof session.created_at === 'string'
                                      ? session.created_at
                                      : null,
                              isProjectArchived: true,
                            })}
                          >
                            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-background/70">
                              <LLMProviderLogo provider={session.__provider} className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs text-foreground">
                                {(typeof session.summary === 'string' && session.summary.trim().length > 0
                                  ? session.summary
                                  : typeof session.name === 'string' && session.name.trim().length > 0
                                    ? session.name
                                    : String(session.id))}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                                <span className="uppercase tracking-wide">{session.__provider}</span>
                                <span aria-hidden>·</span>
                                <span className="tabular-nums">
                                  {formatCompactAge(
                                    typeof session.lastActivity === 'string'
                                      ? session.lastActivity
                                      : typeof session.updated_at === 'string'
                                        ? session.updated_at
                                        : typeof session.created_at === 'string'
                                          ? session.created_at
                                          : null,
                                    projectListProps.currentTime,
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {groupedArchivedSessions.map((group) => (
                <section
                  key={group.key}
                  className="group/archive overflow-hidden rounded-lg border border-border/70 bg-card/45 shadow-[0_1px_0_hsl(var(--border)/0.2)] transition-colors hover:border-border"
                >
                  <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground">
                      <Folder className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <h3 className="truncate text-[13px] font-medium text-foreground">
                          {group.projectDisplayName}
                        </h3>
                        <span className="flex-shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                          {group.sessions.length}
                        </span>
                      </div>
                      {group.projectPath && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                          {group.projectPath}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border/45 bg-muted/[0.08]">
                    {group.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="group/session flex items-center gap-1 border-b border-border/35 px-2.5 py-2 last:border-b-0 hover:bg-accent/35"
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onArchivedSessionClick(session)}
                        >
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-background/70">
                            <LLMProviderLogo provider={session.provider} className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-foreground">
                              {session.sessionTitle}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                              <span className="uppercase tracking-wide">{session.provider}</span>
                              {session.lastActivity && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="tabular-nums">
                                    {formatCompactAge(session.lastActivity, projectListProps.currentTime)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                        <div className="flex flex-shrink-0 items-center gap-0.5">
                          <button
                            className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => onRestoreArchivedSession(session.sessionId)}
                            title={t('archived.restore', 'Restore session')}
                            aria-label={`${t('archived.restore', 'Restore session')}: ${session.sessionTitle}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                            onClick={() => onDeleteArchivedSession(session)}
                            title={t('archived.deletePermanently', 'Delete permanently')}
                            aria-label={`${t('archived.deletePermanently', 'Delete permanently')}: ${session.sessionTitle}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
      </ScrollArea>

      <SidebarSurface
        open={showSettings}
        onClose={onCloseSettings}
        ariaLabel={t('actions.settings')}
        dataSlot="settings-surface"
      >
        <Settings isOpen onClose={onCloseSettings} initialTab={settingsInitialTab} projects={projects} />
      </SidebarSurface>

      <MemorySurface
        open={showMemory}
        onClose={() => setShowMemory(false)}
        isMobile={isMobile}
        t={t}
      />
      </div>

      {!isRenamingOnMobile && (
        <SidebarFooter
          restartRequired={restartRequired}
          settingsOpen={showSettings}
          onToggleSettings={toggleSettings}
          memoryOpen={showMemory}
          onToggleMemory={toggleMemory}
          onDrawerOpened={closeSurfaces}
          plannerRunningCount={plannerRunningCount}
          workerRunningCount={workerRunningCount}
          activeSessionRows={activeSessionRows}
          onOpenActiveSession={onOpenActiveSession}
          isMobile={isMobile}
          t={t}
        />
      )}
    </div>
  );
}
