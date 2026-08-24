import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { Project, LLMProvider } from '../../../types/app';
import type { SidebarProps } from '../types/types';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
};

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
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const navigate = useNavigate();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { restartRequired } = useVersionCheck();
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;
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
    editingSession,
    editingSessionName,
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
    setEditingSession,
    setEditingSessionName,
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
    setCurrentProject,
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

  // Docked tab label: the scoped project's name alone, no wordmark (phase 2
  // chrome strip). Lives here so it runs regardless of sidebar search mode.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.title = selectedProject?.displayName?.trim() || 'Command Center';
  }, [selectedProject]);

  // Planner/worker split and per-project activity for the counters and the
  // border-beam shimmer. Live-run origin/project come from the enriched run
  // registry poll; sessions the UI already loaded fill the gap between polls
  // (activeSessions flips instantly on websocket events).
  const { plannerRunningCount, workerRunningCount, runningByProject, runningJumpTargets } = useMemo(() => {
    const infoBySession = new Map<string, { origin: string | null; projectId: string | null }>();
    for (const project of projects) {
      for (const session of project.sessions ?? []) {
        infoBySession.set(String(session.id), {
          origin: (session.origin as string | null) ?? null,
          projectId: project.projectId,
        });
      }
    }
    for (const run of runningRuns) {
      infoBySession.set(run.sessionId, { origin: run.origin, projectId: run.projectId });
    }

    const runningIds = new Set<string>(runningRuns.map((run) => run.sessionId));
    for (const sessionId of activeSessions.keys()) {
      runningIds.add(sessionId);
    }

    let planner = 0;
    let worker = 0;
    const byProject = new Map<string, number>();
    // Jump-to-running affordance: the counter columns open the first running
    // session of their kind that the sidebar has actually loaded.
    const jumpTargets: { planner: { sessionId: string; projectId: string } | null; worker: { sessionId: string; projectId: string } | null } = {
      planner: null,
      worker: null,
    };
    for (const sessionId of runningIds) {
      const info = infoBySession.get(sessionId);
      const origin = info?.origin ?? null;
      // Same split as the pane headers: planner or null = Willem's chats.
      const kind = origin === 'planner' || origin === null ? 'planner' : 'worker';
      if (kind === 'planner') planner += 1;
      else worker += 1;
      if (info?.projectId) {
        byProject.set(info.projectId, (byProject.get(info.projectId) ?? 0) + 1);
        if (!jumpTargets[kind]) jumpTargets[kind] = { sessionId, projectId: info.projectId };
      }
    }

    return {
      plannerRunningCount: planner,
      workerRunningCount: worker,
      runningByProject: byProject,
      runningJumpTargets: jumpTargets,
    };
  }, [projects, runningRuns, activeSessions]);

  const handleJumpToRunning = useCallback(
    (kind: 'planner' | 'worker') => {
      const target = runningJumpTargets[kind];
      if (!target) return;
      const project = projects.find((p) => p.projectId === target.projectId);
      const session = project?.sessions?.find((s) => String(s.id) === target.sessionId);
      if (session) {
        handleSessionClick({ ...session, __provider: session.__provider ?? 'claude' }, target.projectId);
      }
    },
    [runningJumpTargets, projects, handleSessionClick],
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
    editingSession,
    editingSessionName,
    deletingProjects,
    getProjectSessions,
    loadingMoreProjects,
    activeSessions,
    attentionSessionIds,
    runningByProject,
    workspaceProjectIds,
    onCloseWorkspaceProject,
    selectedSessionId: selectedSession ? String(selectedSession.id) : null,
    forceExpanded: searchMode === 'running',
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
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
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
          projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
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
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            runningSessionsCount={runningSessionsCount}
            plannerRunningCount={plannerRunningCount}
            workerRunningCount={workerRunningCount}
            onJumpToRunning={handleJumpToRunning}
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
            restartRequired={restartRequired}
            onShowSettings={onShowSettings}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
