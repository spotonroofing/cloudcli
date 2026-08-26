import { useEffect, useRef, useState } from 'react';
import { Compass, Hammer, Settings, AlertTriangle, AtSign, BookMarked } from 'lucide-react';
import type { TFunction } from 'i18next';

import { NumberTicker } from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import { authenticatedFetch } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import type { ActiveSessionRow } from '../../types/types';

import AccountsPanel from './AccountsPanel';
import ActiveSessionsDrawer from './ActiveSessionsDrawer';
import MemoryDrawer from './MemoryDrawer';

type SidebarFooterProps = {
  restartRequired: boolean;
  onShowSettings: () => void;
  /** Live planner-origin runs (origin planner or null — Willem's chats). */
  plannerRunningCount: number;
  /** Live worker-origin runs (direct, dispatch, external). */
  workerRunningCount: number;
  /** Labeled active-session rows the counter drawers list (ui11 phase 12). */
  activeSessionRows: ActiveSessionRow[];
  /** Opens a drawer row's session in the pane. */
  onOpenActiveSession: (row: ActiveSessionRow) => void;
  /** The memory viewer's Project tab reads this project's planner memory. */
  selectedProject: Project | null;
  /** Phone: the footer drawers render as full-width bottom sheets. */
  isMobile: boolean;
  t: TFunction;
};

/**
 * One column of the bottom activity bar (ui8 phase 3): icon, label, rolling
 * count on the planner/worker colorway. The column breathes (opacity/filter
 * swell) while its count is nonzero; the whole bar hides when both are zero.
 * A click opens that kind's drawer (ui11 phase 12) — also at count zero, so
 * the behavior never special-cases into a jump.
 */
function ActivityCounterColumn({
  kind,
  count,
  label,
  onOpen,
}: {
  kind: 'planner' | 'worker';
  count: number;
  label: string;
  onOpen: () => void;
}) {
  const Icon = kind === 'planner' ? Compass : Hammer;
  const active = count > 0;

  return (
    <button
      type="button"
      data-slot={`${kind}-counter`}
      data-count={count}
      onClick={onOpen}
      className={cn(
        'flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-medium outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? kind === 'planner'
            ? 'animate-counter-breathe text-primary'
            : 'animate-counter-breathe text-emerald-700 dark:text-emerald-300'
          : 'text-muted-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      <NumberTicker value={count} className="tabular-nums" />
    </button>
  );
}

export default function SidebarFooter({
  restartRequired,
  onShowSettings,
  plannerRunningCount,
  workerRunningCount,
  activeSessionRows,
  onOpenActiveSession,
  selectedProject,
  isMobile,
  t,
}: SidebarFooterProps) {
  const showCounterBar = plannerRunningCount > 0 || workerRunningCount > 0;

  // One footer drawer at a time: the account switcher (ui8 phase 6, drawer in
  // ui11 phase 5), a counter drawer (ui11 phase 12), or the memory viewer
  // (ui12 phase 7). All rise from the same anchor block above Settings.
  const [openDrawer, setOpenDrawer] = useState<'accounts' | 'planner' | 'worker' | 'memory' | null>(null);
  const toggleDrawer = (drawer: 'accounts' | 'planner' | 'worker' | 'memory') =>
    setOpenDrawer((current) => (current === drawer ? null : drawer));
  const [activeAccountEmail, setActiveAccountEmail] = useState<string | null>(null);
  const accountsAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch('/api/accounts/status');
        const body = await response.json();
        const email = body?.data?.active?.email;
        if (!cancelled && typeof email === 'string') {
          setActiveAccountEmail(email);
        }
      } catch {
        // cswap unavailable; the row falls back to a generic label.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Live-run counter bar (ui8 phase 3): one full-width two-column
          rectangle on the app radius — planner left, worker right — pinned to
          the sidebar bottom. Hidden entirely while nothing runs. */}
      {showCounterBar && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5">
            <div
              data-slot="activity-counter-bar"
              className="grid grid-cols-2 divide-x divide-border/60 rounded-lg border border-border/60 bg-muted/30"
            >
              <ActivityCounterColumn
                kind="planner"
                count={plannerRunningCount}
                label={t('running.plannerCounter', 'Planner')}
                onOpen={() => toggleDrawer('planner')}
              />
              <ActivityCounterColumn
                kind="worker"
                count={workerRunningCount}
                label={t('running.workerCounter', 'Worker')}
                onOpen={() => toggleDrawer('worker')}
              />
            </div>
          </div>
        </>
      )}

      {/* Accounts + Settings pinned to the bottom, one treatment on every
          form factor. The accounts row shows the active Claude account and
          opens the accounts drawer, which slides up from this block's top
          edge and overlays the lists (ui11 phase 5). */}
      <div ref={accountsAnchorRef}>
        <div className="nav-divider" />
        <div className="space-y-0.5 px-2 py-1.5">
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={() => toggleDrawer('memory')}
            aria-expanded={openDrawer === 'memory'}
            data-slot="memory-viewer-trigger"
          >
            <BookMarked className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-sm">{t('memory.title', 'Memory')}</span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={() => toggleDrawer('accounts')}
            aria-expanded={openDrawer === 'accounts'}
            data-slot="account-switcher-trigger"
          >
            <AtSign className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="min-w-0 truncate text-sm" data-slot="account-switcher-active">
              {activeAccountEmail ?? t('accounts.title', 'Claude accounts')}
            </span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={onShowSettings}
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="text-sm">{t('actions.settings')}</span>
          </button>
        </div>

        <AccountsPanel
          open={openDrawer === 'accounts'}
          onOpenChange={(open) => setOpenDrawer(open ? 'accounts' : null)}
          onActiveChange={setActiveAccountEmail}
          isMobile={isMobile}
          anchorRef={accountsAnchorRef}
          t={t}
        />

        <MemoryDrawer
          open={openDrawer === 'memory'}
          onClose={() => setOpenDrawer(null)}
          selectedProject={selectedProject}
          isMobile={isMobile}
          anchorRef={accountsAnchorRef}
          t={t}
        />

        {(['planner', 'worker'] as const).map((kind) => (
          <ActiveSessionsDrawer
            key={kind}
            kind={kind}
            open={openDrawer === kind}
            onClose={() => setOpenDrawer(null)}
            rows={activeSessionRows}
            onSelect={(row) => {
              setOpenDrawer(null);
              onOpenActiveSession(row);
            }}
            isMobile={isMobile}
            anchorRef={accountsAnchorRef}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
