import { useState } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, EyeOff, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type { DeleteProjectConfirmation, SessionDeleteConfirmation } from '../../types/types';
import ProjectCreationWizard from '../../../project-creation-wizard';

type SidebarModalsProps = {
  showNewProject: boolean;
  onCloseNewProject: () => void;
  onProjectCreated: () => void;
  deleteConfirmation: DeleteProjectConfirmation | null;
  onCancelDeleteProject: () => void;
  onConfirmDeleteProject: (deleteData?: boolean) => void;
  sessionDeleteConfirmation: SessionDeleteConfirmation | null;
  onCancelDeleteSession: () => void;
  onConfirmDeleteSession: (hardDelete?: boolean) => void;
  t: TFunction;
};

export default function SidebarModals({
  showNewProject,
  onCloseNewProject,
  onProjectCreated,
  deleteConfirmation,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  sessionDeleteConfirmation,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  t,
}: SidebarModalsProps) {
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

      {/* Project archive/delete: shared Dialog chrome (ui9 B5 overlay pass). */}
      <Dialog
        open={Boolean(deleteConfirmation)}
        onOpenChange={(open) => {
          if (!open) cancelDeleteProject();
        }}
      >
        {deleteConfirmation && (
          <DialogContent className="max-w-md overflow-hidden bg-card">
            <DialogTitle>{t('deleteConfirmation.deleteProject')}</DialogTitle>
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                  <AlertTriangle className="h-6 w-6 text-foreground" />
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
          </DialogContent>
        )}
      </Dialog>

      {/* Chat delete: permanent-delete confirm only — archive is its own
          direct menu action (ui9 B5). Shared Dialog chrome. */}
      <Dialog
        open={Boolean(sessionDeleteConfirmation)}
        onOpenChange={(open) => {
          if (!open) onCancelDeleteSession();
        }}
      >
        {sessionDeleteConfirmation && (
          <DialogContent className="max-w-md overflow-hidden bg-card">
            <DialogTitle>{t('deleteConfirmation.deleteSession')}</DialogTitle>
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                  <AlertTriangle className="h-6 w-6 text-foreground" />
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
                    {t(
                      'deleteConfirmation.deletePermanentlyNotice',
                      'This permanently deletes the conversation and its history. This cannot be undone.',
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4">
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
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
