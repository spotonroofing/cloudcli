import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { LLMProvider } from '../../../types/app';
import type { ActiveSessionRow, RunningRunInfo, SidebarProps } from '../types/types';
import { titleFromPrompt } from '../../../../shared/sessionTitle.js';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

function Sidebar({
  projects,
  selectedProject,
  scopedProjectId,
  selectedSession,
  activeSessions,
  attentionSessionIds,
  runningRuns,
  workspaceProjectIds,
  onCloseWorkspaceProject,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  onClose,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const navigate = useNavigate();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { restartRequired } = useVersionCheck();
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const paletteOps = usePaletteOps();

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    runningSessionsCount,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    filteredProjects,
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
    reloadRecentConversations,
    moveSessionToProject,
    archiveSession,
    loadMoreRecentConversations,
    toggleProject,
    handleSessionClick,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    editingPlannerName,
    setEditingPlannerName,
    editingPath,
    setEditingPath,
    editingProjectError,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
  } = useSidebarController({
    projects,
    selectedProject,
    scopedProjectId,
    selectedSession,
    activeSessions,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  // Settings lives in the sidebar now (ui13 job 5): opening it from the
  // collapsed rail (or anywhere else) expands the sidebar so the surface
  // has somewhere to slide up.
  useEffect(() => {
    if (showSettings && isSidebarCollapsed) {
      handleExpandSidebar();
    }
  }, [showSettings, isSidebarCollapsed, handleExpandSidebar]);

  // Docked tab label: the scoped project's name alone, no wordmark (phase 2
  // chrome strip). Lives here so it runs regardless of sidebar search mode.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.title = selectedProject?.displayName?.trim() || 'Command Center';
  }, [selectedProject]);

  // Planner/worker split and per-project activity for the counters and the
  // border-beam shimmer, plus the labeled row list the counter drawers show
  // (ui11 phase 12). Live-run identity comes from the enriched run registry
  // poll; sessions the UI already loaded fill the gap between polls
  // (activeSessions flips instantly on websocket events).
  const { plannerRunningCount, workerRunningCount, runningByProject, unlistedRunningByProject, activeSessionRows } = useMemo(() => {
    type SessionInfo = {
      origin: string | null;
      projectId: string | null;
      projectDisplayName: string | null;
      title: string | null;
      provider: LLMProvider;
      run: RunningRunInfo | null;
    };
    const infoBySession = new Map<string, SessionInfo>();
    // Sessions the chat list renders; a running session outside this set
    // (worker-origin rows never list as chats) has no row to carry a beam.
    const listedIds = new Set<string>();
    for (const project of projects) {
      for (const session of project.sessions ?? []) {
        listedIds.add(String(session.id));
        infoBySession.set(String(session.id), {
          origin: (session.origin as string | null) ?? null,
          projectId: project.projectId,
          projectDisplayName: project.displayName ?? null,
          title: titleFromPrompt((session.summary || session.title || session.name || null) as string | null) || null,
          provider: session.__provider ?? session.provider ?? 'claude',
          run: null,
        });
      }
    }
    for (const run of runningRuns) {
      const loaded = infoBySession.get(run.sessionId);
      infoBySession.set(run.sessionId, {
        origin: run.origin,
        projectId: run.projectId,
        projectDisplayName: run.projectDisplayName ?? loaded?.projectDisplayName ?? null,
        title: titleFromPrompt(run.title) || loaded?.title || null,
        provider: run.provider,
        run,
      });
    }

    const runningIds = new Set<string>(runningRuns.map((run) => run.sessionId));
    for (const sessionId of activeSessions.keys()) {
      runningIds.add(sessionId);
    }

    let planner = 0;
    let worker = 0;
    const byProject = new Map<string, number>();
    const unlistedByProject = new Map<string, number>();
    const rows: ActiveSessionRow[] = [];
    for (const sessionId of runningIds) {
      const info = infoBySession.get(sessionId);
      const origin = info?.origin ?? null;
      // Same split as the pane headers: planner or null = Willem's chats.
      const kind = origin === 'planner' || origin === null ? 'planner' : 'worker';
      if (kind === 'planner') planner += 1;
      else worker += 1;
      if (info?.projectId) {
        byProject.set(info.projectId, (byProject.get(info.projectId) ?? 0) + 1);
        if (!listedIds.has(sessionId)) {
          unlistedByProject.set(info.projectId, (unlistedByProject.get(info.projectId) ?? 0) + 1);
        }
      }

      // Worker rows carry the run switcher's label; planner rows the session
      // title. A running session is working; one the registry still lists but
      // no stream marks processing is idle; unseen activity is attention.
      const run = info?.run ?? null;
      let label: string;
      if (kind === 'worker') {
        if (origin === 'maintenance') {
          label = 'Maintenance: Monday self-check';
        } else if (run?.chainSlug) {
          label = run.chainPhase
            ? `${run.chainSlug} Job ${run.chainPhase}${run.chainPhaseName ? ` - ${run.chainPhaseName}` : ''}`
            : run.chainSlug;
        } else {
          label = info?.title || `run ${sessionId.slice(0, 8)}`;
        }
      } else {
        label = info?.title || t('running.untitledSession', 'New session');
      }
      rows.push({
        sessionId,
        kind,
        label,
        projectId: info?.projectId ?? null,
        projectDisplayName: info?.projectDisplayName ?? null,
        state: activeSessions.has(sessionId)
          ? 'working'
          : attentionSessionIds.has(sessionId)
            ? 'attention'
            : 'idle',
        provider: info?.provider ?? 'claude',
      });
    }

    return {
      plannerRunningCount: planner,
      workerRunningCount: worker,
      runningByProject: byProject,
      unlistedRunningByProject: unlistedByProject,
      activeSessionRows: rows,
    };
  }, [projects, runningRuns, activeSessions, attentionSessionIds, t]);

  // Opens a drawer row's session. Sessions the sidebar has not loaded open
  // through a constructed session object, the same way conversation search
  // hits do — the old counter jump silently no-opped on unloaded sessions.
  const handleOpenActiveSession = useCallback(
    (row: ActiveSessionRow) => {
      const project = row.projectId ? projects.find((p) => p.projectId === row.projectId) : null;
      const loaded = project?.sessions?.find((s) => String(s.id) === row.sessionId);
      if (loaded) {
        handleSessionClick({ ...loaded, __provider: loaded.__provider ?? 'claude' }, row.projectId ?? '');
        return;
      }
      handleSessionClick(
        { id: row.sessionId, __provider: row.provider, __projectId: row.projectId ?? undefined },
        row.projectId ?? '',
      );
    },
    [projects, handleSessionClick],
  );

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  // Standalone chat: navigate to /standalone, where the app selects the
  // scratch-backed pseudo project itself (URL scoping would override any
  // project object set from here).
  const handleNewStandaloneChat = () => {
    navigate('/standalone');
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    editingProject,
    editingName,
    editingPlannerName,
    editingPath,
    editingProjectError,
    initialSessionsLoaded,
    currentTime,
    deletingProjects,
    getProjectSessions,
    loadingMoreProjects,
    activeSessions,
    runningByProject,
    unlistedRunningByProject,
    workspaceProjectIds,
    onCloseWorkspaceProject,
    selectedSessionId: selectedSession ? String(selectedSession.id) : null,
    onEditingNameChange: setEditingName,
    onEditingPlannerNameChange: setEditingPlannerName,
    onEditingPathChange: setEditingPath,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onArchiveSession: (sessionId: string) => {
      void archiveSession(sessionId);
    },
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: loadMoreSessionsForProject,
    onNewSession,
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onMoveSessionToProject: (sessionId: string, projectPath: string | null) => {
      void moveSessionToProject(sessionId, projectPath);
    },
    t,
  };

  return (
    <>
      <SidebarModals
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        t={t}
      />

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          restartRequired={restartRequired}
          plannerRunningCount={plannerRunningCount}
          workerRunningCount={workerRunningCount}
          t={t}
        />
      ) : (
        <>
        <SidebarContent
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            runningSessionsCount={runningSessionsCount}
            plannerRunningCount={plannerRunningCount}
            workerRunningCount={workerRunningCount}
            activeSessionRows={activeSessionRows}
            onOpenActiveSession={handleOpenActiveSession}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            recentConversations={recentConversations}
            recentConversationsTotal={recentConversationsTotal}
            recentConversationsHasMore={recentConversationsHasMore}
            isRecentConversationsLoading={isRecentConversationsLoading}
            isLoadingMoreRecentConversations={isLoadingMoreRecentConversations}
            recentConversationsError={recentConversationsError}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            searchMode={searchMode}
            onSearchModeChange={(mode) => {
              setSearchMode(mode);
              if (mode === 'projects') clearConversationResults();
            }}
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onRestoreArchivedProject={restoreArchivedProject}
            onLoadMoreRecentConversations={loadMoreRecentConversations}
            onRetryRecentConversations={reloadRecentConversations}
            onRenameConversation={(sessionId, name) => {
              void updateSessionSummary('', sessionId, name, 'claude');
            }}
            onMoveConversationToProject={(sessionId, projectPath) => {
              void moveSessionToProject(sessionId, projectPath);
            }}
            onArchiveConversation={(sessionId) => {
              void archiveSession(sessionId);
            }}
            onDeleteConversation={(projectId, sessionId, sessionTitle, provider) => {
              showDeleteSessionConfirmation(projectId, sessionId, sessionTitle, provider);
            }}
            onNewStandaloneChat={handleNewStandaloneChat}
            onArchivedSessionClick={openArchivedSession}
            onRestoreArchivedSession={restoreArchivedSession}
            onDeleteArchivedSession={(session) => {
              showDeleteSessionConfirmation(
                session.projectId,
                session.sessionId,
                session.sessionTitle,
                session.provider,
                { isArchived: true },
              );
            }}
            onConversationResultClick={(projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => {
              // `projectId` (DB key) is the canonical identifier post-migration.
              // The server emits null when it can't resolve a project row for
              // the search hit; treat that as "no project" and still navigate
              // to the session so the user can open it from the URL.
              const resolvedProvider = (provider || 'claude') as LLMProvider;
              const project = projectId ? projects.find(p => p.projectId === projectId) : null;
              const searchTarget = { __searchTargetTimestamp: messageTimestamp || null, __searchTargetSnippet: messageSnippet || null };
              const sessionObj = {
                id: sessionId,
                __provider: resolvedProvider,
                __projectId: projectId ?? undefined,
                ...searchTarget,
              };
              if (project) {
                handleProjectSelect(project);
                const sessions = getProjectSessions(project);
                const existing = sessions.find(s => s.id === sessionId);
                if (existing) {
                  handleSessionClick({ ...existing, ...searchTarget }, project.projectId);
                } else {
                  handleSessionClick(sessionObj, project.projectId);
                }
              } else {
                handleSessionClick(sessionObj, projectId ?? '');
              }
            }}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            onCreateProject={() => setShowNewProject(true)}
            onCollapseSidebar={handleCollapseSidebar}
            onClose={onClose}
            restartRequired={restartRequired}
            onShowSettings={onShowSettings}
            showSettings={showSettings}
            settingsInitialTab={settingsInitialTab}
            onCloseSettings={onCloseSettings}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
