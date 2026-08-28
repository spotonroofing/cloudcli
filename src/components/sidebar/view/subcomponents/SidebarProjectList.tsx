import { useEffect, useRef } from 'react';
import type { TFunction } from 'i18next';

import { BounceIndicator } from '../../../../shared/view/beui';
import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import { getPageTitle } from '../../../../utils/pageTitle';
import type { ResponseIndicatorInfo, SessionWithProvider } from '../../types/types';

import type { ActivityKinds } from './ResponseSignal';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  editingPlannerName: string;
  editingPath: string;
  editingProjectError: string | null;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  deletingProjects: Set<string>;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  onLoadMoreSessions: (projectId: string) => void;
  loadingMoreProjects: Set<string>;
  activeSessions: SessionActivityMap;
  /** Live-run counts per projectId and identity; drives the project-row beam. */
  runningByProject: ReadonlyMap<string, { planner: number; worker: number }>;
  /** Live runs per projectId with no chat row to carry the beam. */
  unlistedRunningByProject: ReadonlyMap<string, { planner: number; worker: number }>;
  responseIndicators: ReadonlyMap<string, ResponseIndicatorInfo>;
  responseKindsByProject: ReadonlyMap<string, ActivityKinds>;
  onSessionViewed: (sessionId: string) => void;
  /** Projects open as multi-project workspace rows (desktop only). */
  workspaceProjectIds?: string[];
  /** Closes a project's workspace row (sidebar hover-close). */
  onCloseWorkspaceProject?: (project: Project) => void;
  /** Bounce-dot destination: the selected session's row, when it is in this list. */
  selectedSessionId: string | null;
  onEditingNameChange: (value: string) => void;
  onEditingPlannerNameChange: (value: string) => void;
  onEditingPathChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onNewSession: (project: Project) => void;
  onMoveSessionToProject: (sessionId: string, projectPath: string | null) => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

export default function SidebarProjectList({
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
  onLoadMoreSessions,
  loadingMoreProjects,
  activeSessions,
  runningByProject,
  unlistedRunningByProject,
  responseIndicators,
  responseKindsByProject,
  onSessionViewed,
  workspaceProjectIds,
  onCloseWorkspaceProject,
  selectedSessionId,
  onEditingNameChange,
  onEditingPlannerNameChange,
  onEditingPathChange,
  onToggleProject,
  onProjectSelect,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  onNewSession,
  onMoveSessionToProject,
  onSaveEditingSession,
  t,
}: SidebarProjectListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const pageTitle = getPageTitle(selectedProject, selectedSession);
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  return (
    <div ref={listRef} className="relative md:space-y-1">
      {/* beUI bounce-sidebar behavior: the active dot arcs to the selected
          session's row on a curved spring path. */}
      {showProjects && (
        <BounceIndicator activeKey={selectedSessionId} containerRef={listRef} />
      )}
      {!showProjects
        ? state
        : filteredProjects.map((project) => (
            // React key + per-project state lookups all use the DB `projectId`
            // so they remain stable across renames and session changes.
            <SidebarProjectItem
              key={project.projectId}
              project={project}
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isExpanded={expandedProjects.has(project.projectId)}
              isDeleting={deletingProjects.has(project.projectId)}
              editingProject={editingProject}
              editingName={editingName}
              editingPlannerName={editingPlannerName}
              editingPath={editingPath}
              editingProjectError={editingProjectError}
              sessions={getProjectSessions(project)}
              initialSessionsLoaded={initialSessionsLoaded.has(project.projectId)}
              isLoadingMoreSessions={loadingMoreProjects.has(project.projectId)}
              currentTime={currentTime}
              onEditingNameChange={onEditingNameChange}
              onEditingPlannerNameChange={onEditingPlannerNameChange}
              onEditingPathChange={onEditingPathChange}
              onToggleProject={onToggleProject}
              onProjectSelect={onProjectSelect}
              onStartEditingProject={onStartEditingProject}
              onCancelEditingProject={onCancelEditingProject}
              onSaveProjectName={onSaveProjectName}
              onDeleteProject={onDeleteProject}
              onSessionSelect={onSessionSelect}
              onArchiveSession={onArchiveSession}
              onDeleteSession={onDeleteSession}
              onLoadMoreSessions={onLoadMoreSessions}
              activeSessions={activeSessions}
              runningKinds={runningByProject.get(project.projectId) ?? { planner: 0, worker: 0 }}
              unlistedRunningKinds={unlistedRunningByProject.get(project.projectId) ?? { planner: 0, worker: 0 }}
              responseIndicators={responseIndicators}
              responseKinds={responseKindsByProject.get(project.projectId) ?? { planner: false, worker: false }}
              onSessionViewed={onSessionViewed}
              // The workspace only renders with 2+ rows; a persisted lone
              // entry must not read as "open in workspace" in the sidebar.
              isInWorkspace={Boolean(
                workspaceProjectIds
                && workspaceProjectIds.length >= 2
                && workspaceProjectIds.includes(project.projectId),
              )}
              onCloseWorkspaceProject={onCloseWorkspaceProject}
              onNewSession={onNewSession}
              onMoveSessionToProject={onMoveSessionToProject}
              onSaveEditingSession={onSaveEditingSession}
              t={t}
            />
          ))}
    </div>
  );
}
