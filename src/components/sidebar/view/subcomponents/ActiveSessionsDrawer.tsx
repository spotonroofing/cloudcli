import { useMemo } from 'react';
import type { RefObject } from 'react';
import { Compass, Hammer } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { ActiveSessionRow } from '../../types/types';

import SidebarFooterDrawer from './SidebarFooterDrawer';

type ActiveSessionsDrawerProps = {
  kind: 'planner' | 'worker';
  open: boolean;
  onClose: () => void;
  /** All active rows; the drawer filters to its own kind. */
  rows: ActiveSessionRow[];
  onSelect: (row: ActiveSessionRow) => void;
  isMobile: boolean;
  anchorRef: RefObject<HTMLDivElement>;
  t: TFunction;
};

const STATE_DOT: Record<ActiveSessionRow['state'], string> = {
  working: 'animate-pulse bg-emerald-500',
  attention: 'bg-amber-500',
  idle: 'bg-muted-foreground/40',
};

/**
 * Counter drawer (ui11 phase 12): clicking the planner or worker counter in
 * the sidebar footer opens this drawer on the footer drawer shell, listing
 * every active session of that kind grouped by project — never jumping to an
 * arbitrary session. Each row shows the session's label and live state
 * (working, waiting on Willem, idle); tapping a row opens that session.
 */
export default function ActiveSessionsDrawer({
  kind,
  open,
  onClose,
  rows,
  onSelect,
  isMobile,
  anchorRef,
  t,
}: ActiveSessionsDrawerProps) {
  const Icon = kind === 'planner' ? Compass : Hammer;

  const groups = useMemo(() => {
    const byProject = new Map<string, ActiveSessionRow[]>();
    for (const row of rows) {
      if (row.kind !== kind) continue;
      const key = row.projectDisplayName ?? '';
      const group = byProject.get(key);
      if (group) group.push(row);
      else byProject.set(key, [row]);
    }
    // Named projects alphabetically, the project-less bucket last.
    return [...byProject.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [rows, kind]);

  const stateLabel = (state: ActiveSessionRow['state']): string => {
    if (state === 'working') return t('running.stateWorking', 'Working');
    if (state === 'attention') return t('running.stateAttention', 'Waiting on Willem');
    return t('running.stateIdle', 'Idle');
  };

  const title = kind === 'planner'
    ? t('running.plannerDrawerTitle', 'Active planner sessions')
    : t('running.workerDrawerTitle', 'Active worker runs');

  return (
    <SidebarFooterDrawer
      open={open}
      onClose={onClose}
      isMobile={isMobile}
      anchorRef={anchorRef}
      ariaLabel={title}
      dataSlot={`${kind}-sessions-drawer`}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {t('running.drawerSubtitle', 'Tap a session to open it')}
          </p>
        </div>
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
      </div>

      {groups.length === 0 ? (
        <div className="px-4 py-8 text-center" data-slot="active-sessions-empty">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-base font-medium text-foreground">
            {kind === 'planner'
              ? t('running.plannerDrawerEmptyTitle', 'No planner sessions running')
              : t('running.workerDrawerEmptyTitle', 'No worker runs')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('running.emptyDescription', 'Active work will appear here while a provider is processing.')}
          </p>
        </div>
      ) : (
        <ul className="max-h-[60dvh] space-y-3 overflow-y-auto px-4 py-3">
          {groups.map(([projectName, groupRows]) => (
            <li key={projectName || '__none__'} data-slot="active-sessions-group">
              <p className="mb-1.5 truncate px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {projectName || t('running.noProject', 'No project')}
              </p>
              <ul className="space-y-2">
                {groupRows.map((row) => (
                  <li key={row.sessionId}>
                    <button
                      type="button"
                      className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelect(row)}
                      data-slot="active-session-row"
                      data-session-id={row.sessionId}
                      data-state={row.state}
                    >
                      <span
                        className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STATE_DOT[row.state])}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={row.label}>
                        {row.label}
                      </span>
                      <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {stateLabel(row.state)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SidebarFooterDrawer>
  );
}
