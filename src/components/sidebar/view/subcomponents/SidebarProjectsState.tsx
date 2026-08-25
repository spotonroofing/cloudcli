import { Folder, Search } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Skeleton } from '../../../../shared/view/ui';
import type { LoadingProgress } from '../../../../types/app';

type SidebarProjectsStateProps = {
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  projectsCount: number;
  filteredProjectsCount: number;
  t: TFunction;
};

export default function SidebarProjectsState({
  isLoading,
  loadingProgress,
  projectsCount,
  filteredProjectsCount,
  t,
}: SidebarProjectsStateProps) {
  if (isLoading) {
    // Project rows still arriving: row-shaped skeletons hold the list's space
    // (ui11 phase 11); the scan progress stays as one honest muted line.
    return (
      <div className="space-y-1 px-2 py-1" aria-busy="true" aria-live="polite">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex min-h-9 items-center gap-2 rounded-lg px-2 md:min-h-9">
            <Skeleton className="size-5 rounded-[5px]" />
            <Skeleton className="h-3.5 rounded-sm" style={{ width: `${[70, 45, 60, 50, 65][row]}%` }} />
          </div>
        ))}
        {loadingProgress && loadingProgress.total > 0 && (
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            {loadingProgress.current}/{loadingProgress.total} {t('projects.projects')}
          </p>
        )}
      </div>
    );
  }

  if (projectsCount === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Folder className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('projects.noProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.runClaudeCli')}</p>
      </div>
    );
  }

  if (filteredProjectsCount === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('projects.noMatchingProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.tryDifferentSearch')}</p>
      </div>
    );
  }

  return null;
}
