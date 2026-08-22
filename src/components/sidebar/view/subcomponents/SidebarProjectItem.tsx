import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown, ChevronRight, Edit3, Folder, FolderOpen, Trash2, X } from 'lucide-react';
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
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';

import TaskIndicator from './TaskIndicator';
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
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  /** Live runs inside this project; the row shimmers while nonzero and collapsed. */
  runningSessionCount: number;
  onEditingNameChange: (name: string) => void;
  onEditingPlannerNameChange: (name: string) => void;
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

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  editingProject,
  editingName,
  editingPlannerName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  runningSessionCount,
  onEditingNameChange,
  onEditingPlannerNameChange,
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
  const totalSessionCount = Number(project.sessionMeta?.total ?? sessions.length);
  const sessionCountDisplay = getSessionCountDisplay(project, sessions);
  const sessionCountLabel = `${sessionCountDisplay} session${totalSessionCount === 1 ? '' : 's'}`;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const [hovered, setHovered] = useState(false);
  // Activity shimmer: the project row carries the beam while any of its
  // sessions runs; expanding hands the shimmer to the running chat rows —
  // every hand-off is the engine's fade, never a hard cutoff.
  const beam = useBeamPresence(runningSessionCount > 0 && !isExpanded);

  useEffect(() => {
    if (!isEditing || !mobileRenameInputRef.current) {
      return;
    }

    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        mobileRenameInputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    };

    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const toggleProject = () => onToggleProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId);
  };

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-0.5', isDeleting && 'opacity-50 pointer-events-none')}>
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'relative p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
            )}
            onClick={toggleProject}
          >
            {beam.mounted && <BorderBeamOverlay {...beam.beamProps} />}
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {!isEditing && <ProjectIcon project={project} expanded={isExpanded} />}
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="space-y-1">
                      <input
                        ref={mobileRenameInputRef}
                        type="text"
                        value={editingName}
                        onChange={(event) => onEditingNameChange(event.target.value)}
                        className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                        placeholder={t('projects.projectNamePlaceholder')}
                        autoFocus
                        autoComplete="off"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            saveProjectName();
                          }

                          if (event.key === 'Escape') {
                            onCancelEditingProject();
                          }
                        }}
                        style={{
                          fontSize: '16px',
                          WebkitAppearance: 'none',
                          borderRadius: '8px',
                        }}
                      />
                      <input
                        type="text"
                        value={editingPlannerName}
                        onChange={(event) => onEditingPlannerNameChange(event.target.value)}
                        className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                        placeholder={t('projects.plannerMemoryNamePlaceholder')}
                        autoComplete="off"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            saveProjectName();
                          }

                          if (event.key === 'Escape') {
                            onCancelEditingProject();
                          }
                        }}
                        style={{
                          fontSize: '16px',
                          WebkitAppearance: 'none',
                          borderRadius: '8px',
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <h3 className="truncate text-sm font-normal text-foreground">{project.displayName}</h3>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteProject(project);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>

                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartEditingProject(project);
                      }}
                    >
                      <Edit3 className="h-4 w-4 text-primary" />
                    </button>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Desktop project row on the beUI ai-sidebar anatomy: min-h-9 rounded
            row, icon tile, overflow-aware marquee label, hover-revealed
            actions, spring-rotated chevron. */}
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
            'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            isSelected && 'bg-muted text-foreground',
          )}
        >
          {beam.mounted && <BorderBeamOverlay {...beam.beamProps} />}
          <ProjectIcon project={project} expanded={isExpanded} />

          {isEditing ? (
            <div className="min-w-0 flex-1 space-y-1 py-1.5" onClick={(event) => event.stopPropagation()}>
              <input
                type="text"
                value={editingName}
                onChange={(event) => onEditingNameChange(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                placeholder={t('projects.projectNamePlaceholder')}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveProjectName();
                  }
                  if (event.key === 'Escape') {
                    onCancelEditingProject();
                  }
                }}
              />
              <input
                type="text"
                value={editingPlannerName}
                onChange={(event) => onEditingPlannerNameChange(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                placeholder={t('projects.plannerMemoryNamePlaceholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveProjectName();
                  }
                  if (event.key === 'Escape') {
                    onCancelEditingProject();
                  }
                }}
              />
              <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                {project.fullPath}
              </div>
            </div>
          ) : (
            <MarqueeLabel active={hovered}>{project.displayName}</MarqueeLabel>
          )}

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                  {sessionCountDisplay}
                </span>
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
                  <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
                <motion.span
                  className="flex h-4 w-4 items-center justify-center"
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={SPRING_LAYOUT}
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover/project:text-foreground" />
                </motion.span>
              </>
            )}
          </div>
        </div>
      </div>

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
