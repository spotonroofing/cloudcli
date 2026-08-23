import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Edit3, Folder, FolderOpen, Rows2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  BorderBeamOverlay,
  MarqueeLabel,
  SPRING_LAYOUT,
  useBeamPresence,
} from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';

import ProjectEditDialog from './ProjectEditDialog';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  editingProject: string | null;
  editingName: string;
  editingPlannerName: string;
  editingPath: string;
  editingProjectError: string | null;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  /** Live runs inside this project; the row shimmers while nonzero and collapsed. */
  runningSessionCount: number;
  /** True when the project is open as a multi-project workspace row. */
  isInWorkspace: boolean;
  /** Opens the project as a workspace row, or closes its row when already open. */
  onToggleWorkspaceProject?: (project: Project) => void;
  onEditingNameChange: (name: string) => void;
  onEditingPlannerNameChange: (name: string) => void;
  onEditingPathChange: (path: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onMoveSession: (sessionId: string, sessionTitle: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

const getSessionCountDisplay = (project: Project, sessions: SessionWithProvider[]): string => {
  const total = Number(project.sessionMeta?.total ?? sessions.length);
  return String(total);
};

/**
 * Project identity mark, left of the name: the project's own icon (repo-root
 * convention or bundled SpotOn icon, delivered as a data URL) when it has
 * one, else the beUI ai-sidebar default — lucide Folder/FolderOpen in a
 * size-5 grid tile.
 */
export function ProjectIcon({ project, expanded }: { project: Project; expanded: boolean }) {
  const FallbackIcon = expanded ? FolderOpen : Folder;
  return (
    <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center" data-slot="project-icon">
      {project.iconDataUrl ? (
        <img src={project.iconDataUrl} alt="" className="h-4 w-4 rounded-[3px] object-contain" />
      ) : (
        <FallbackIcon className="size-4" />
      )}
    </span>
  );
}

/**
 * Static sibling of the bounce dot (ui8 phase 3): marks a project row as
 * holding open work while its chat rows can't carry the dot — the project
 * holding the open chat is collapsed, or the project is open as a workspace
 * row. Same size and seat as the bounce dot, slightly quieter ink.
 */
function ProjectOpenIndicator() {
  return (
    <span
      aria-hidden="true"
      data-slot="project-open-indicator"
      className="pointer-events-none absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/70"
    />
  );
}

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  editingProject,
  editingName,
  editingPlannerName,
  editingPath,
  editingProjectError,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  runningSessionCount,
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
  onDeleteSession,
  onLoadMoreSessions,
  activeSessions,
  attentionSessionIds,
  isInWorkspace,
  onToggleWorkspaceProject,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onMoveSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const isSelected = selectedProject?.projectId === project.projectId;
  const isEditing = editingProject === project.projectId;
  const sessionCountDisplay = getSessionCountDisplay(project, sessions);
  const [hovered, setHovered] = useState(false);
  // Activity shimmer: the project row carries the beam while any of its
  // sessions runs; expanding hands the shimmer to the running chat rows —
  // every hand-off is the engine's fade, never a hard cutoff.
  const beam = useBeamPresence(runningSessionCount > 0 && !isExpanded);
  // The row-level open indicator stands in for the bounce dot whenever the
  // dot's destination row isn't rendered: the open chat's project is
  // collapsed, or the project is open as a workspace row.
  const showOpenIndicator = (isSelected && Boolean(selectedSession) && !isExpanded) || isInWorkspace;

  const toggleProject = () => onToggleProject(project.projectId);

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-0.5', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="md:group group">
        {/* Mobile project row: the same beUI ai-sidebar row anatomy as the
            desktop row below — borderless min-h rounded row, icon tile,
            marquee label with the count inline at the title's end, spring
            chevron — with touch adaptations: taller row, always-visible
            actions with 44px hit areas. */}
        <div className="md:hidden">
          <div
            role="button"
            tabIndex={0}
            onClick={toggleProject}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleProject();
              }
            }}
            className={cn(
              'group/project relative flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm outline-none',
              'text-muted-foreground transition-colors active:text-foreground',
              isSelected && 'text-foreground',
            )}
          >
            {beam.mounted && <BorderBeamOverlay {...beam.beamProps} />}
            {showOpenIndicator && <ProjectOpenIndicator />}
            <ProjectIcon project={project} expanded={isExpanded} />

            <span className="flex min-w-0 flex-1 items-center">
              <MarqueeLabel active={false} className="max-w-full flex-initial">{project.displayName}</MarqueeLabel>
              <span className="shrink-0 pl-1.5 text-[10px] tabular-nums text-muted-foreground/70" data-slot="project-session-count">
                {sessionCountDisplay}
              </span>
            </span>

            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                className="touch-hit relative flex h-8 w-8 items-center justify-center rounded transition-colors active:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartEditingProject(project);
                }}
                aria-label={t('tooltips.renameProject')}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                className="touch-hit relative flex h-8 w-8 items-center justify-center rounded transition-colors active:bg-red-50 dark:active:bg-red-900/20"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteProject(project);
                }}
                aria-label={t('tooltips.deleteProject')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <motion.span
                className="flex h-4 w-4 items-center justify-center"
                animate={{ rotate: isExpanded ? 90 : 0 }}
                transition={SPRING_LAYOUT}
              >
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </motion.span>
            </div>
          </div>
        </div>

        {/* Desktop project row on the beUI ai-sidebar anatomy: min-h-9 rounded
            row, icon tile, overflow-aware marquee label with the count inline
            at the title's end, hover-revealed actions, spring-rotated chevron.
            No filled hover/selected block — hover is an ink shift; the bounce
            dot (or the row's open indicator) marks open work. */}
        <div
          role="button"
          tabIndex={0}
          title={project.fullPath}
          onClick={selectAndToggleProject}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectAndToggleProject();
            }
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            'group/project relative hidden min-h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm outline-none md:flex',
            'text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            isSelected && 'text-foreground',
          )}
        >
          {beam.mounted && <BorderBeamOverlay {...beam.beamProps} />}
          {showOpenIndicator && <ProjectOpenIndicator />}
          <ProjectIcon project={project} expanded={isExpanded} />

          <span className="flex min-w-0 flex-1 items-center">
            <MarqueeLabel active={hovered} className="max-w-full flex-initial">{project.displayName}</MarqueeLabel>
            <span className="shrink-0 pl-1.5 text-[10px] tabular-nums text-muted-foreground/70" data-slot="project-session-count">
              {sessionCountDisplay}
            </span>
          </span>

          <div className="flex flex-shrink-0 items-center gap-1">
            {onToggleWorkspaceProject && !isSelected && (
              <div
                className={cn(
                  'touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-all duration-200 hover:bg-accent',
                  isInWorkspace
                    ? 'text-primary opacity-100'
                    : 'opacity-0 group-hover/project:opacity-100',
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWorkspaceProject(project);
                }}
                title={isInWorkspace ? 'Remove from workspace' : 'Open as workspace row'}
                data-workspace-toggle={project.projectId}
              >
                <Rows2 className="h-3 w-3" />
              </div>
            )}
            <div
              className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-accent group-hover/project:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onStartEditingProject(project);
              }}
              title={t('tooltips.renameProject')}
            >
              <Edit3 className="h-3 w-3" />
            </div>
            <div
              className="touch:opacity-100 flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-red-50 group-hover/project:opacity-100 dark:hover:bg-red-900/20"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteProject(project);
              }}
              title={t('tooltips.deleteProject')}
            >
              <Trash2 className="h-3 w-3" />
            </div>
            <motion.span
              className="flex h-4 w-4 items-center justify-center"
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={SPRING_LAYOUT}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover/project:text-foreground" />
            </motion.span>
          </div>
        </div>
      </div>

      {isEditing && (
        <ProjectEditDialog
          project={project}
          open={isEditing}
          name={editingName}
          plannerName={editingPlannerName}
          path={editingPath}
          error={editingProjectError}
          onNameChange={onEditingNameChange}
          onPlannerNameChange={onEditingPlannerNameChange}
          onPathChange={onEditingPathChange}
          onSave={() => onSaveProjectName(project.projectId)}
          onCancel={onCancelEditingProject}
          t={t}
        />
      )}

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        attentionSessionIds={attentionSessionIds}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onMoveSession={onMoveSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />
    </div>
  );
}
