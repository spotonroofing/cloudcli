import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { Project } from '../../../../types/app';

import { ProjectIcon } from './SidebarProjectItem';

type ProjectEditDialogProps = {
  project: Project;
  open: boolean;
  name: string;
  plannerName: string;
  path: string;
  /** Save failure reason from the server; the dialog stays open to show it. */
  error: string | null;
  onNameChange: (value: string) => void;
  onPlannerNameChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  t: TFunction;
};

/**
 * Project edit dialog (ui8 phase 3): the inline stacked row inputs became a
 * proper labeled form — title, path (editable), planner memory name — on the
 * shared Dialog chrome, one treatment on both form factors.
 */
export default function ProjectEditDialog({
  project,
  open,
  name,
  plannerName,
  path,
  error,
  onNameChange,
  onPlannerNameChange,
  onPathChange,
  onSave,
  onCancel,
  t,
}: ProjectEditDialogProps) {
  const fieldId = (suffix: string) => `project-edit-${project.projectId}-${suffix}`;

  const submit = () => {
    onSave();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-0" data-slot="project-edit-dialog">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ProjectIcon project={project} expanded={false} />
          </span>
          <div className="min-w-0">
            <DialogTitle className="not-sr-only text-sm font-medium text-foreground">
              {t('projects.editProject', 'Edit project')}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground" title={project.fullPath}>
              {project.displayName}
            </p>
          </div>
        </div>

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={fieldId('name')} className="block text-xs font-medium text-muted-foreground">
              {t('projects.editTitleLabel', 'Title')}
            </label>
            <Input
              id={fieldId('name')}
              type="text"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t('projects.projectNamePlaceholder')}
              autoComplete="off"
              className="text-base md:text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={fieldId('path')} className="block text-xs font-medium text-muted-foreground">
              {t('projects.editPathLabel', 'Path')}
            </label>
            <Input
              id={fieldId('path')}
              type="text"
              value={path}
              onChange={(event) => onPathChange(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-base md:text-xs"
            />
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('projects.editPathHint', 'The folder this project points at. Sessions follow the project when the path changes.')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={fieldId('planner')} className="block text-xs font-medium text-muted-foreground">
              {t('projects.editPlannerLabel', 'Planner memory name')}
            </label>
            <Input
              id={fieldId('planner')}
              type="text"
              value={plannerName}
              onChange={(event) => onPlannerNameChange(event.target.value)}
              placeholder={t('projects.plannerMemoryNamePlaceholder')}
              autoComplete="off"
              className="text-base md:text-sm"
            />
          </div>
        </form>

        {error && (
          <p className="px-5 pb-3 text-xs text-destructive" data-slot="project-edit-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={submit}>
            {t('tooltips.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
