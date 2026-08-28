import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Settings, AlertTriangle, AtSign, BookMarked } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { authenticatedFetch } from '../../../../utils/api';
import type { ActiveSessionRow } from '../../types/types';

import AccountsPanel from './AccountsPanel';
import ActiveSessionsDrawer from './ActiveSessionsDrawer';
import ActivityCounterButton from './ActivityCounterButton';
import type { ActivityKinds } from './ResponseSignal';

type SidebarFooterProps = {
  restartRequired: boolean;
  /** Whether the full-sidebar Settings surface is open (ui13 job 5). */
  settingsOpen: boolean;
  /** Toggles the full-sidebar Settings surface. */
  onToggleSettings: () => void;
  /** Whether the full-sidebar Memory surface is open (ui13 job 5). */
  memoryOpen: boolean;
  /** Toggles the full-sidebar Memory surface. */
  onToggleMemory: () => void;
  /** A footer drawer just opened — the parent closes any open surface. */
  onDrawerOpened: () => void;
  /** Live planner-origin runs (origin planner or null — Willem's chats). */
  plannerRunningCount: number;
  /** Live worker-origin runs (direct, dispatch, external). */
  workerRunningCount: number;
  /** Unseen completed responses, using the same planner/worker identity. */
  responseKinds: ActivityKinds;
  /** Labeled active-session rows the counter drawers list (ui11 phase 12). */
  activeSessionRows: ActiveSessionRow[];
  /** Opens a drawer row's session in the pane. */
  onOpenActiveSession: (row: ActiveSessionRow) => void;
  /** Phone: the footer drawers render as full-width bottom sheets. */
  isMobile: boolean;
  t: TFunction;
};

/**
 * One taskbar icon (ui13 job 4): icon-only, 44px hit area via touch-hit. The
 * open drawer's icon reads selected; the others dim while any drawer is open.
 */
function TaskbarButton({
  icon: Icon,
  label,
  onClick,
  selected = false,
  dimmed = false,
  expanded,
  dataSlot,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  selected?: boolean;
  dimmed?: boolean;
  expanded?: boolean;
  dataSlot?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        'touch-hit relative flex h-9 w-9 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'bg-accent/60 text-foreground'
          : dimmed
            ? 'text-muted-foreground/40 hover:text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      data-slot={dataSlot}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export default function SidebarFooter({
  restartRequired,
  settingsOpen,
  onToggleSettings,
  memoryOpen,
  onToggleMemory,
  onDrawerOpened,
  plannerRunningCount,
  workerRunningCount,
  responseKinds,
  activeSessionRows,
  onOpenActiveSession,
  isMobile,
  t,
}: SidebarFooterProps) {
  const showCounterBar = plannerRunningCount > 0 || workerRunningCount > 0;

  // One footer drawer at a time: the account switcher (ui8 phase 6, drawer in
  // ui11 phase 5) or a counter drawer (ui11 phase 12). Both unfold in-flow
  // above the taskbar (ui13 job 4); Settings and Memory left for full-sidebar
  // surfaces the parent owns (ui13 job 5).
  const [openDrawer, setOpenDrawer] = useState<'accounts' | 'activity' | null>(null);
  const toggleDrawer = (drawer: 'accounts' | 'activity') =>
    setOpenDrawer((current) => {
      if (current === drawer) return null;
      onDrawerOpened();
      return drawer;
    });
  const [activeAccountEmail, setActiveAccountEmail] = useState<string | null>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Drives the taskbar's selected/dimmed treatment across both the footer
  // drawers and the full-sidebar surfaces: one control reads selected at a
  // time, the rest dim.
  const anyOpen = openDrawer !== null || settingsOpen || memoryOpen;

  // Footer drawers and full-sidebar surfaces are mutually exclusive (ui14
  // job 4): a surface opening ramps any open drawer closed, the mirror of
  // onDrawerOpened closing the surfaces.
  useEffect(() => {
    if (settingsOpen || memoryOpen) setOpenDrawer(null);
  }, [settingsOpen, memoryOpen]);

  useEffect(() => {
    if (!showCounterBar && openDrawer === 'activity') setOpenDrawer(null);
  }, [openDrawer, showCounterBar]);

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
        // cswap unavailable; the icon falls back to a generic label.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Desktop: a press outside the footer (drawer + taskbar) closes the open
  // drawer; presses inside stay with the triggers so a second tap toggles.
  // Mobile sheets close through their own scrim.
  useEffect(() => {
    if (openDrawer === null || openDrawer === 'accounts' || isMobile) return;
    const onPointerDown = (event: PointerEvent) => {
      if (footerRef.current && !footerRef.current.contains(event.target as Node)) {
        setOpenDrawer(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openDrawer, isMobile]);

  return (
    <div
      ref={footerRef}
      className="flex-shrink-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
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
              className="rounded-lg border border-border/60 bg-muted/30"
            >
              <ActivityCounterButton
                plannerCount={plannerRunningCount}
                workerCount={workerRunningCount}
                plannerLabel={t('running.plannerCounter', 'Planner')}
                workerLabel={t('running.workerCounter', 'Worker')}
                responseKinds={responseKinds}
                onOpen={() => toggleDrawer('activity')}
              />
            </div>
          </div>
        </>
      )}

      {/* The divider above the drawer region fades out while a desktop drawer
          is open (ui14 job 4): the open drawer's own top padding separates it
          from the list, no bar. */}
      <div
        className={cn(
          'nav-divider transition-opacity duration-300',
          !isMobile && openDrawer !== null && 'opacity-0',
        )}
      />

      {/* Footer drawers unfold here, between the divider and the taskbar, on
          the sidebar's own background (ui13 job 4): opening grows the footer
          so the lists above squish up; the taskbar never moves. */}
      <AccountsPanel
        open={openDrawer === 'accounts'}
        onOpenChange={(open) => setOpenDrawer(open ? 'accounts' : null)}
        onActiveChange={setActiveAccountEmail}
        isMobile={isMobile}
        dismissOnOutside={false}
        t={t}
      />

      <ActiveSessionsDrawer
        kinds={([
          plannerRunningCount > 0 ? 'planner' : null,
          workerRunningCount > 0 ? 'worker' : null,
        ].filter(Boolean) as Array<'planner' | 'worker'>)}
        open={openDrawer === 'activity'}
        onClose={() => setOpenDrawer(null)}
        rows={activeSessionRows}
        onSelect={(row) => {
          setOpenDrawer(null);
          onOpenActiveSession(row);
        }}
        isMobile={isMobile}
        t={t}
      />

      {/* The footer taskbar (ui13 job 4): one left-aligned row of icon-only
          controls — Settings, account, Memory. */}
      <div className="flex items-center gap-1 px-2 py-1.5" data-slot="sidebar-taskbar">
        <TaskbarButton
          icon={Settings}
          label={t('actions.settings')}
          onClick={onToggleSettings}
          selected={settingsOpen}
          dimmed={anyOpen && !settingsOpen}
          expanded={settingsOpen}
          dataSlot="settings-trigger"
        />
        <TaskbarButton
          icon={AtSign}
          label={activeAccountEmail ?? t('accounts.title', 'Accounts')}
          onClick={() => toggleDrawer('accounts')}
          selected={openDrawer === 'accounts'}
          dimmed={anyOpen && openDrawer !== 'accounts'}
          expanded={openDrawer === 'accounts'}
          dataSlot="account-switcher-trigger"
        />
        <TaskbarButton
          icon={BookMarked}
          label={t('memory.title', 'Memory')}
          onClick={onToggleMemory}
          selected={memoryOpen}
          dimmed={anyOpen && !memoryOpen}
          expanded={memoryOpen}
          dataSlot="memory-viewer-trigger"
        />
      </div>
    </div>
  );
}
