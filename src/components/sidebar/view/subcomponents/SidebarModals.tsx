import { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, EyeOff, Folder, FolderInput, MessageSquare, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import Settings from '../../../settings/view/Settings';
import type { Project } from '../../../../types/app';
import { normalizeProjectForSettings } from '../../utils/utils';
import type { DeleteProjectConfirmation, MoveSessionTarget, SessionDeleteConfirmation, SettingsProject } from '../../types/types';
import ProjectCreationWizard from '../../../project-creation-wizard';

type SidebarModalsProps = {
  projects: Project[];
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  showNewProject: boolean;
  onCloseNewProject: () => void;
  onProjectCreated: () => void;
  deleteConfirmation: DeleteProjectConfirmation | null;
  onCancelDeleteProject: () => void;
  onConfirmDeleteProject: (deleteData?: boolean) => void;
  sessionDeleteConfirmation: SessionDeleteConfirmation | null;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: (hardDelete?: boolean) => void;
  moveSessionTarget: MoveSessionTarget | null;
  onCancelMoveSession: () => void;
  onMoveSessionToProject: (projectPath: string | null) => void;
  t: TFunction;
};

type TypedSettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects: SettingsProject[];
  initialTab: string;
};

const SettingsComponent = Settings as (props: TypedSettingsProps) => JSX.Element;

function TypedSettings(props: TypedSettingsProps) {
  return <SettingsComponent {...props} />;
}

export default function SidebarModals({
  projects,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  showNewProject,
  onCloseNewProject,
  onProjectCreated,
  deleteConfirmation,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  sessionDeleteConfirmation,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  moveSessionTarget,
  onCancelMoveSession,
  onMoveSessionToProject,
  t,
}: SidebarModalsProps) {
  // Settings expects project identity/path fields to be present for dropdown labels and local-scope MCP config.
  const settingsProjects = useMemo(
    () => projects.map(normalizeProjectForSettings),
    [projects],
  );

  // Second stage of the project dialog: the chosen action ('archive' | 'delete')
  // waits for an explicit confirm before anything happens.
  const [confirmingProjectAction, setConfirmingProjectAction] = useState<'archive' | 'delete' | null>(null);

  const cancelDeleteProject = () => {
    setConfirmingProjectAction(null);
    onCancelDeleteProject();
  };

  const confirmProjectAction = () => {
    const action = confirmingProjectAction;
    setConfirmingProjectAction(null);
    onConfirmDeleteProject(action === 'delete');
  };

  return (
    <>
      {showNewProject &&
        ReactDOM.createPortal(
          <ProjectCreationWizard
            onClose={onCloseNewProject}
            onProjectCreated={onProjectCreated}
          />,
          document.body,
        )}

      {showSettings &&
        ReactDOM.createPortal(
          <TypedSettings
            isOpen={showSettings}
            onClose={onCloseSettings}
            projects={settingsProjects}
            initialTab={settingsInitialTab}
          />,
          document.body,
        )}

      {moveSessionTarget &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
              <div className="p-6 pb-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                    <FolderInput className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-1 text-lg font-semibold text-foreground">
                      {t('moveSession.title', 'Move chat to project')}
                    </h3>
                    <p className="truncate text-sm text-muted-foreground" title={moveSessionTarget.sessionTitle}>
                      {moveSessionTarget.sessionTitle}
                    </p>
                  </div>
                </div>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto border-t border-border p-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
                  onClick={() => onMoveSessionToProject(null)}
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  {t('moveSession.noProject', 'No project (standalone)')}
                </button>
                {projects.map((project) => (
                  <button
                    key={project.projectId}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
                    onClick={() => onMoveSessionToProject(project.fullPath || project.path || '')}
                  >
                    <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{project.displayName || project.projectId}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-border bg-muted/30 p-3">
                <Button variant="ghost" className="w-full" onClick={onCancelMoveSession}>
                  {t('actions.cancel')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {deleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${
                      confirmingProjectAction === 'delete'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-amber-100 dark:bg-amber-900/30'
                    }`}
                  >
                    <AlertTriangle
                      className={`h-6 w-6 ${
                        confirmingProjectAction === 'delete'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {confirmingProjectAction === 'delete'
                        ? t('deleteConfirmation.confirmDeleteTitle', 'Delete all project data?')
                        : confirmingProjectAction === 'archive'
                          ? t('deleteConfirmation.confirmArchiveTitle', 'Remove this project?')
                          : t('deleteConfirmation.deleteProject')}
                    </h3>
                    <p className="mb-1 text-sm text-muted-foreground">
                      {confirmingProjectAction ? null : <>{t('deleteConfirmation.confirmDelete')}{' '}</>}
                      <span className="font-medium text-foreground">
                        {deleteConfirmation.project.displayName || deleteConfirmation.project.projectId}
                      </span>
                      {confirmingProjectAction ? null : '?'}
                    </p>
                    {confirmingProjectAction === 'delete' && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t(
                          'deleteConfirmation.deleteAllDataWarning',
                          'This permanently deletes the project and all of its conversations. This cannot be undone.',
                        )}
                      </p>
                    )}
                    {confirmingProjectAction === 'archive' && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t('deleteConfirmation.allConversationsDeleted')}{' '}
                        {t('deleteConfirmation.cannotUndo')}
                      </p>
                    )}
                    {!confirmingProjectAction && deleteConfirmation.sessionCount > 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t('deleteConfirmation.sessionCount', { count: deleteConfirmation.sessionCount })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
                {confirmingProjectAction ? (
                  <>
                    <Button
                      variant={confirmingProjectAction === 'delete' ? 'destructive' : 'outline'}
                      className={`w-full justify-start ${
                        confirmingProjectAction === 'delete' ? 'bg-red-600 text-white hover:bg-red-700' : ''
                      }`}
                      onClick={confirmProjectAction}
                    >
                      {confirmingProjectAction === 'delete' ? (
                        <Trash2 className="mr-2 h-4 w-4" />
                      ) : (
                        <EyeOff className="mr-2 h-4 w-4" />
                      )}
                      {confirmingProjectAction === 'delete'
                        ? t('deleteConfirmation.deleteAllData')
                        : t('deleteConfirmation.archiveProject', 'Archive project')}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={() => setConfirmingProjectAction(null)}>
                      {t('actions.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => setConfirmingProjectAction('archive')}
                    >
                      <EyeOff className="mr-2 h-4 w-4" />
                      {t('deleteConfirmation.archiveProject', 'Archive project')}
                    </Button>
                    <Button
                      variant="destructive"
                      className="w-full justify-start bg-red-600 text-white hover:bg-red-700"
                      onClick={() => setConfirmingProjectAction('delete')}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('deleteConfirmation.deleteAllData')}
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={cancelDeleteProject}>
                      {t('actions.cancel')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {sessionDeleteConfirmation &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">
                      {t('deleteConfirmation.deleteSession')}
                    </h3>
                    <p className="mb-1 text-sm text-muted-foreground">
                      {t('deleteConfirmation.confirmDelete')}{' '}
                      <span className="font-medium text-foreground">
                        {sessionDeleteConfirmation.sessionTitle || t('sessions.unnamed')}
                      </span>
                      ?
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {sessionDeleteConfirmation.isArchived
                        ? t('deleteConfirmation.archivedSessionNotice', 'This session is already archived. You can keep it hidden or delete it permanently.')
                        : t('deleteConfirmation.archiveSessionNotice', 'Archive keeps the session out of the active list while preserving its history.')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
                {!sessionDeleteConfirmation.isArchived && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onConfirmDeleteSession(false)}
                  >
                    <EyeOff className="mr-2 h-4 w-4" />
                    {t('deleteConfirmation.archiveSession', 'Archive session')}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="w-full justify-start bg-red-600 text-white hover:bg-red-700"
                  onClick={() => onConfirmDeleteSession(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('deleteConfirmation.deleteSessionPermanently', 'Delete permanently')}
                </Button>
                <Button variant="ghost" className="w-full" onClick={onCancelDeleteSession}>
                  {t('actions.cancel')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
