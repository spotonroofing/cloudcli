import { useMemo } from 'react';
import { Compass, Hammer } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { ActiveSessionRow } from '../../types/types';

import SidebarFooterDrawer from './SidebarFooterDrawer';

type ActiveSessionsDrawerProps = {
  kinds: Array<'planner' | 'worker'>;
  open: boolean;
  onClose: () => void;
  /** All active rows; the drawer filters to its own kind. */
  rows: ActiveSessionRow[];
  onSelect: (row: ActiveSessionRow) => void;
  isMobile: boolean;
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
  kinds,
  open,
  onClose,
  rows,
  onSelect,
  isMobile,
  t,
}: ActiveSessionsDrawerProps) {
  const sections = useMemo(() => kinds.map((kind) => {
    const byProject = new Map<string, ActiveSessionRow[]>();
    for (const row of rows) {
      if (row.kind !== kind) continue;
      const key = row.projectDisplayName ?? '';
      const group = byProject.get(key);
      if (group) group.push(row);
      else byProject.set(key, [row]);
    }
    const groups = [...byProject.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
    return { kind, groups };
  }), [rows, kinds]);

  const stateLabel = (state: ActiveSessionRow['state']): string => {
    if (state === 'working') return t('running.stateWorking', 'Working');
    if (state === 'attention') return t('running.stateAttention', 'Waiting on Willem');
    return t('running.stateIdle', 'Idle');
  };

  const title = kinds.length === 2
    ? t('running.combinedDrawerTitle', 'Active sessions')
    : kinds[0] === 'planner'
      ? t('running.plannerDrawerTitle', 'Active planner sessions')
      : t('running.workerDrawerTitle', 'Active worker runs');

  return (
    <SidebarFooterDrawer
      open={open}
      onClose={onClose}
      isMobile={isMobile}
      ariaLabel={title}
      dataSlot="active-sessions-drawer"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {t('running.drawerSubtitle', 'Tap a session to open it')}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-muted-foreground" aria-hidden>
          {kinds.includes('planner') && <Compass className="h-4 w-4" />}
          {kinds.includes('worker') && <Hammer className="h-4 w-4" />}
        </span>
      </div>

      {sections.every((section) => section.groups.length === 0) ? (
        <div className="px-4 py-8 text-center" data-slot="active-sessions-empty">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50">
            {kinds[0] === 'worker'
              ? <Hammer className="h-6 w-6 text-muted-foreground" />
              : <Compass className="h-6 w-6 text-muted-foreground" />}
          </div>
          <h3 className="mb-1 text-base font-medium text-foreground">
            {kinds[0] === 'planner'
              ? t('running.plannerDrawerEmptyTitle', 'No planner sessions running')
              : t('running.workerDrawerEmptyTitle', 'No worker runs')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('running.emptyDescription', 'Active work will appear here while a provider is processing.')}
          </p>
        </div>
      ) : (
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto px-4 py-3">
          {sections.map(({ kind, groups }) => {
            const Icon = kind === 'planner' ? Compass : Hammer;
            return (
              <section key={kind} data-slot="active-sessions-section" data-kind={kind}>
                <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden />
                  {kind === 'planner' ? t('running.plannerCounter', 'Planner') : t('running.workerCounter', 'Worker')}
                </h3>
                <ul className="space-y-3">
                  {groups.map(([projectName, groupRows]) => (
                    <li key={projectName || '__none__'} data-slot="active-sessions-group">
                      <p className="mb-1.5 truncate px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
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
                              <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STATE_DOT[row.state])} aria-hidden />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{row.label}</span>
                              <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{stateLabel(row.state)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </SidebarFooterDrawer>
  );
}
