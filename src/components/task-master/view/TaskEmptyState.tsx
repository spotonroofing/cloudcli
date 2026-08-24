import { FileText, Settings, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { PrdFile } from '../types';

type TaskEmptyStateProps = {
  className?: string;
  hasTaskMasterDirectory: boolean;
  existingPrds: PrdFile[];
  onOpenSetupModal: () => void;
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
};

export default function TaskEmptyState({
  className = '',
  hasTaskMasterDirectory,
  existingPrds,
  onOpenSetupModal,
  onCreatePrd,
  onOpenPrd,
}: TaskEmptyStateProps) {
  const { t } = useTranslation('tasks');

  if (!hasTaskMasterDirectory) {
    return (
      <div className={cn('text-center py-12', className)}>
        <div className="mx-auto max-w-md">
          <div className="mb-4 text-muted-foreground">
            <Settings className="mx-auto mb-4 h-12 w-12" />
          </div>

          <h3 className="mb-2 text-lg font-semibold text-foreground">{t('notConfigured.title')}</h3>
          <p className="mb-6 text-sm text-muted-foreground">{t('notConfigured.description')}</p>

          <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 text-left">
            <h4 className="mb-3 text-sm font-medium text-foreground">{t('notConfigured.whatIsTitle')}</h4>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>- {t('notConfigured.features.aiPowered')}</p>
              <p>- {t('notConfigured.features.prdTemplates')}</p>
              <p>- {t('notConfigured.features.dependencyTracking')}</p>
              <p>- {t('notConfigured.features.progressVisualization')}</p>
              <p>- {t('notConfigured.features.cliIntegration')}</p>
            </div>
          </div>

          <button
            onClick={onOpenSetupModal}
            className="mx-auto flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Terminal className="h-4 w-4" />
            {t('notConfigured.initializeButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('text-center py-12', className)}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 rounded-lg border border-border bg-muted/30 p-6 text-left">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t('gettingStarted.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('gettingStarted.subtitle')}</p>
            </div>
          </div>

          <div className="mb-4 space-y-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <h4 className="mb-1 font-medium text-foreground">1. {t('gettingStarted.steps.createPRD.title')}</h4>
              <p className="mb-3 text-sm text-muted-foreground">{t('gettingStarted.steps.createPRD.description')}</p>

              <button
                onClick={onCreatePrd}
                className="inline-flex items-center gap-2 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
              >
                <FileText className="h-3 w-3" />
                {t('gettingStarted.steps.createPRD.addButton')}
              </button>

              {existingPrds.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-2 text-xs text-muted-foreground">{t('gettingStarted.steps.createPRD.existingPRDs')}</p>
                  <div className="flex flex-wrap gap-2">
                    {existingPrds.map((prd) => (
                      <button
                        key={prd.name}
                        onClick={() => onOpenPrd(prd)}
                        className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        <FileText className="h-3 w-3" />
                        {prd.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <h4 className="mb-1 font-medium text-foreground">2. {t('gettingStarted.steps.generateTasks.title')}</h4>
              <p className="text-sm text-muted-foreground">{t('gettingStarted.steps.generateTasks.description')}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <h4 className="mb-1 font-medium text-foreground">3. {t('gettingStarted.steps.analyzeTasks.title')}</h4>
              <p className="text-sm text-muted-foreground">{t('gettingStarted.steps.analyzeTasks.description')}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <h4 className="mb-1 font-medium text-foreground">4. {t('gettingStarted.steps.startBuilding.title')}</h4>
              <p className="text-sm text-muted-foreground">{t('gettingStarted.steps.startBuilding.description')}</p>
            </div>
          </div>

          <button
            onClick={onCreatePrd}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            <FileText className="h-4 w-4" />
            {t('buttons.addPRD')}
          </button>
        </div>

        <p className="text-sm text-muted-foreground">{t('gettingStarted.tip')}</p>
      </div>
    </div>
  );
}
