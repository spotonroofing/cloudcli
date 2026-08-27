import { Hammer, MessageSquare, Milestone, Plus, Terminal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import ChatInterface from '../chat/view/ChatInterface';
import PaneShell from '../app/workspace/PaneShell';
import { PANE_HEADER_CLASS } from '../app/workspace/paneHeader';
import ErrorBoundary from '../main-content/view/ErrorBoundary';
import MobileMenuButton from '../main-content/view/subcomponents/MobileMenuButton';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { authenticatedFetch } from '../../utils/api';
import { onSettingChange, writeSetting } from '../../utils/cloudSettings';
import { cn } from '../../lib/utils';
import { Badge, Button, Skeleton, Tooltip } from '../../shared/view/ui';
import { ActionSwapIcon } from '../../shared/view/beui';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';
import type { Project, ProjectSession } from '../../types/app';
import { titleFromPrompt } from '../../../shared/sessionTitle.js';

import JobsSidebar, { type ChainSnapshot, type JobGroup } from './JobsSidebar';

const JOBS_VIEW_PREFERENCE_KEY = 'worker-jobs-view-open-v1';

const readJobsViewPreference = (projectPath: string): boolean => {
  try {
    const stored = JSON.parse(localStorage.getItem(JOBS_VIEW_PREFERENCE_KEY) || '{}') as Record<string, unknown>;
    return stored[projectPath] === true;
  } catch {
    return false;
  }
};

const persistJobsViewPreference = (projectPath: string, open: boolean): void => {
  let stored: Record<string, boolean> = {};
  try {
    stored = JSON.parse(localStorage.getItem(JOBS_VIEW_PREFERENCE_KEY) || '{}') as Record<string, boolean>;
  } catch {
    // Replace a corrupt boot cache with the next valid per-project record.
  }
  writeSetting(JOBS_VIEW_PREFERENCE_KEY, JSON.stringify({ ...stored, [projectPath]: open }));
};

type WorkerRun = {
  sessionId: string;
  provider: string;
  origin: 'direct' | 'dispatch' | 'maintenance' | string | null;
  /** True when the run's first message was an auto-sent boot prompt. */
  booted?: boolean;
  chainSlug: string | null;
  /** 1-based unit index inside the dispatch chain; null outside chains. */
  chainPhase: number | null;
  /** Set on a unit's verifier session (ui14 job 10); absent on build sessions. */
  chainStage?: 'verify';
  title: string | null;
  state: 'running' | 'finished' | 'stopped';
  model: string | null;
  lastActivity: string | null;
};

/**
 * Chain runs read "slug Job N - name" from the dispatch manifest (never the
 * bare slug repeated); then the session title, then a short honest id — never
 * a provider placeholder.
 */
const runLabel = (run: WorkerRun, chains: Record<string, ChainSnapshot>): string => {
  // Monday maintenance runs are a system kind, labeled as such (spec B9).
  if (run.origin === 'maintenance') {
    return 'Maintenance: Monday self-check';
  }
  if (run.chainSlug) {
    if (run.chainPhase) {
      const name = chains[run.chainSlug]?.manifest?.[run.chainPhase - 1]?.name;
      const stage = run.chainStage === 'verify' ? ' verify' : '';
      return name
        ? `${run.chainSlug} Job ${run.chainPhase}${stage} - ${name}`
        : `${run.chainSlug} Job ${run.chainPhase}${stage}`;
    }
    return run.chainSlug;
  }
  return titleFromPrompt(run.title) || `run ${run.sessionId.slice(0, 8)}`;
};

type WorkerPaneProps = {
  selectedProject: Project;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isActive: boolean;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  processingSessions?: SessionActivityMap;
  onShowSettings?: () => void;
  /** Desktop split only: hides the pane. Omitted on the mobile tab. */
  onClose?: () => void;
  /** Overrides the close button's label; workspace rows close the whole row here. */
  closeLabel?: string;
  /**
   * Jobs take over the whole pane instead of opening as a side column: the
   * workspace sets this at three or more projects in column layout (ui14 job 1).
   */
  jobsTakeover?: boolean;
  /** Phone only (ui14 job 11): the top bar opens the sidebar and carries the window selector. */
  onMenuClick?: () => void;
  windowSelector?: ReactNode;
};

/**
 * The always-there worker surface (spec B2): a full interactive chat pinned
 * beside the project's chats. It auto-follows the most recent worker session
 * (origin direct or dispatch). The top bar matches the planner pane's: the
 * Hammer icon, "Worker", and the shown run's title, with no dropdown — the
 * jobs list is the navigation between runs (ui14 job 2); the right end holds
 * the new-session plus, the hide X, and the job sign (the jobs toggle).
 */
export default function WorkerPane({
  selectedProject,
  ws,
  sendMessage,
  isActive,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onShowSettings,
  onClose,
  closeLabel,
  jobsTakeover = false,
  onMenuClick,
  windowSelector,
}: WorkerPaneProps) {
  const { subscribe, isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  // Jobs behind the top bar's job sign (ui14 job 1): a side column beside the
  // transcript, or the whole pane where the pane is too narrow for both — at
  // three or more projects in column layout, and on phones. The cloud-synced
  // record is keyed by project, so reloads and other devices restore the same
  // view without one project's choice leaking into another.
  const [jobsViewOpen, setJobsViewOpenState] = useState(() => readJobsViewPreference(projectPath));
  const setJobsViewOpen = useCallback((value: boolean | ((open: boolean) => boolean)) => {
    setJobsViewOpenState((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (projectPath) persistJobsViewPreference(projectPath, next);
      return next;
    });
  }, [projectPath]);
  // Mobile chat/shell toggle (ui13 job 9): swaps the pane's transcript for a
  // terminal bound to the pane's own session, mirroring the planner pane.
  const [shellOpen, setShellOpen] = useState(false);
  const [paneSession, setPaneSession] = useState<ProjectSession | null>(null);
  const [runs, setRuns] = useState<WorkerRun[]>([]);
  // False until the first run fetch for this project settles; the top bar
  // holds its space with a skeleton meanwhile (ui11 phase 11).
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [chains, setChains] = useState<Record<string, ChainSnapshot>>({});
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  // Auto-follow pauses while the user is composing a brand-new pane session or
  // has pinned an older run in the switcher, so a dispatched run landing
  // mid-thought cannot steal the surface.
  const followLatestRef = useRef(true);
  // Typing into an existing worker chat continues that chat: while the
  // composer is focused, a dispatched run landing must not swap the session
  // out from under the message being written.
  const [composerFocused, setComposerFocused] = useState(false);
  // Fail-safes for the pane header: the socket dropping, or the rendered
  // transcript diverging from the run the header claims.
  const [renderedSessionId, setRenderedSessionId] = useState<string | null>(null);
  const [streamMismatch, setStreamMismatch] = useState(false);
  const claimedSessionId = paneSession?.id ?? null;
  useEffect(() => {
    // A just-created pane session renders before paneSession catches up, so
    // only a mismatch that persists counts as broken wiring.
    if (!renderedSessionId || !claimedSessionId || renderedSessionId === claimedSessionId) {
      setStreamMismatch(false);
      return;
    }
    const timer = setTimeout(() => setStreamMismatch(true), 2000);
    return () => clearTimeout(timer);
  }, [renderedSessionId, claimedSessionId]);

  useEffect(() => {
    setJobsViewOpenState(readJobsViewPreference(projectPath));
    return onSettingChange([JOBS_VIEW_PREFERENCE_KEY], () => {
      setJobsViewOpenState(readJobsViewPreference(projectPath));
    });
  }, [projectPath]);

  const refreshRuns = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    try {
      const response = await authenticatedFetch(
        `/api/providers/sessions/worker-runs?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as {
        data?: { runs?: WorkerRun[]; chains?: Record<string, ChainSnapshot> };
      };
      setRuns(body.data?.runs ?? []);
      setChains(body.data?.chains ?? {});
    } catch {
      // transient; the poll retries
    } finally {
      setRunsLoaded(true);
    }
  }, [projectPath]);

  // Project switch: reset and re-resolve which worker runs to show.
  useEffect(() => {
    setPaneSession(null);
    setRuns([]);
    setRunsLoaded(false);
    setChains({});
    followLatestRef.current = true;
    void refreshRuns();
  }, [refreshRuns]);

  // Watcher deltas plus a slow poll keep the run list and its states honest
  // even when a dispatched chain starts sessions with no browser involved.
  // chain_progress is the watchdog streaming per-phase progress: merge the
  // snapshot for an instant navigator update, then refetch to reconcile runs.
  useEffect(() => {
    const unsubscribe = subscribe?.((event: {
      kind?: string;
      chain?: ChainSnapshot;
      project?: { projectId?: string } | null;
    } | null) => {
      // Only this project's sessions can change its run list (ui13 job 15):
      // another project's transcript writes used to refetch every open pane.
      if (event?.kind === 'session_upserted' && event.project?.projectId === selectedProject.projectId) {
        void refreshRuns();
      }
      if (event?.kind === 'chain_progress' && event.chain) {
        const chain = event.chain;
        setChains((previous) =>
          previous[chain.slug] || chain.projectPath === projectPath
            ? { ...previous, [chain.slug]: chain }
            : previous,
        );
        void refreshRuns();
      }
    });
    const interval = setInterval(() => {
      void refreshRuns();
    }, 20_000);
    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [subscribe, refreshRuns, projectPath, selectedProject.projectId]);

  // Auto-follow: the newest run is selected until the user pins another one.
  // Held off while the composer is focused; it catches up on blur.
  const latest = runs[0] ?? null;
  useEffect(() => {
    if (!latest || !followLatestRef.current || composerFocused || paneSession?.id === latest.sessionId) {
      return;
    }
    setPaneSession({
      id: latest.sessionId,
      __provider: (latest.provider || 'claude') as ProjectSession['__provider'],
      summary: latest.title ?? undefined,
      origin: latest.origin ?? null,
      booted: Boolean(latest.booted),
    });
  }, [latest, paneSession?.id, composerFocused]);

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      setComposerFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  const handleSelectRun = (run: WorkerRun) => {
    // Picking the newest run resumes auto-follow; anything older pins it.
    followLatestRef.current = run.sessionId === runs[0]?.sessionId;
    setPaneSession((previous) =>
      previous?.id === run.sessionId
        ? previous
        : {
            id: run.sessionId,
            __provider: (run.provider || 'claude') as ProjectSession['__provider'],
            summary: run.title ?? undefined,
            origin: run.origin ?? null,
            booted: Boolean(run.booted),
          },
    );
  };

  const handleNewWorkerSession = () => {
    followLatestRef.current = false;
    setPaneSession(null);
    setJobsViewOpen(false);
    setNewSessionTrigger((previous) => previous + 1);
  };

  const selectedRun = runs.find((run) => run.sessionId === paneSession?.id) ?? null;
  // The title after "Worker" (ui14 job 2), in the planner header's style: the
  // run's own session title, else the chain label ("slug Job N - name"); a
  // fresh, unsent pane session has none yet.
  const paneTitle = selectedRun
    ? (titleFromPrompt(selectedRun.title) || runLabel(selectedRun, chains))
    : titleFromPrompt(paneSession?.summary);

  // Jobs are the navigation (ui13 job 2) and the list spans every run of the
  // project (ui14 job 1): each chain is a group carrying the sessions its
  // units have, each chain-less run is a one-row group, newest first. Every
  // selection routes through handleSelectRun so pin/auto-follow holds.
  const jobGroups: JobGroup[] = [
    ...Object.values(chains).map((chain) => {
      const sessions: Record<number, string> = {};
      // The job row opens the build session; the verify session (ui14 job
      // 10) is reached from the drawer's verify row instead.
      for (const run of runs) {
        if (run.chainSlug === chain.slug && run.chainPhase != null && run.chainStage !== 'verify') {
          sessions[run.chainPhase] = run.sessionId;
        }
      }
      return { chain, run: null, sessions, startedAt: chain.startedAt };
    }),
    ...runs
      .filter((run) => !run.chainSlug)
      .map((run) => ({
        chain: null,
        run: { label: runLabel(run, chains), state: run.state },
        sessions: { 1: run.sessionId },
        startedAt: run.lastActivity ? Date.parse(run.lastActivity) : 0,
      })),
  ].sort((a, b) => b.startedAt - a.startedAt);
  const handleOpenSession = (sessionId: string) => {
    const target = runs.find((run) => run.sessionId === sessionId);
    if (target) {
      handleSelectRun(target);
    }
  };
  const jobsFullPane = jobsTakeover || isMobile;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Worker top bar (ui14 job 2): the planner header's anatomy — icon,
          "Worker", the shown run's title as plain text (no dropdown; jobs are
          the navigation). No status words; the two badges are wiring fail-safes. */}
      <div className={PANE_HEADER_CLASS} data-slot="pane-header">
        {isMobile && onMenuClick && <MobileMenuButton onMenuClick={onMenuClick} />}
        <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Worker</span>
        {!runsLoaded && <Skeleton className="h-3 w-36 rounded-sm" />}
        {runsLoaded && paneTitle && (
          <span data-slot="worker-run-name" className="min-w-0 truncate text-[11px] text-muted-foreground">
            {paneTitle}
          </span>
        )}
        {streamMismatch && (
          <Badge status="danger" size="sm" className="flex-shrink-0">
            stream mismatch
          </Badge>
        )}
        {!isConnected && (
          <Badge status="danger" size="sm" className="flex-shrink-0">
            disconnected
          </Badge>
        )}
        <span className="min-w-0 flex-1" />
        {isMobile && windowSelector}
        {isMobile && (
          <Tooltip content={shellOpen ? 'Show chat' : 'Show shell'} position="bottom">
            <Button
              variant="ghost"
              size="sm"
              className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setShellOpen((open) => !open)}
              aria-label={shellOpen ? 'Show chat' : 'Show shell'}
              data-slot="pane-view-toggle"
            >
              <ActionSwapIcon value={shellOpen ? 'chat' : 'shell'}>
                {shellOpen
                  ? <MessageSquare className="h-3.5 w-3.5" />
                  : <Terminal className="h-3.5 w-3.5" />}
              </ActionSwapIcon>
            </Button>
          </Tooltip>
        )}
        <Tooltip content="New worker session" position="bottom">
          <Button
            variant="ghost"
            size="sm"
            data-slot="worker-new-session"
            className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={handleNewWorkerSession}
            aria-label="New worker session"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        {onClose && (
          <Tooltip content={closeLabel ?? 'Hide worker pane'} position="bottom">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label={closeLabel ?? 'Hide worker pane'}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
        {runsLoaded && jobGroups.length > 0 && (
          <Tooltip content={jobsViewOpen ? 'Hide jobs' : 'Show jobs'} position="bottom">
            <Button
              variant="ghost"
              size="sm"
              data-slot="worker-jobs-toggle"
              aria-pressed={jobsViewOpen}
              aria-label={jobsViewOpen ? 'Hide jobs' : 'Show jobs'}
              onClick={() => setJobsViewOpen((open) => !open)}
              className={cn(
                'touch-hit relative h-6 w-6 p-0 hover:text-foreground',
                jobsViewOpen ? 'bg-accent/60 text-foreground' : 'text-muted-foreground',
              )}
            >
              <Milestone className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <PaneShell
          project={selectedProject}
          session={paneSession}
          open={isMobile && shellOpen && !jobsViewOpen}
          busy={Boolean(paneSession && processingSessions?.has(String(paneSession.id)))}
          hidden={jobsViewOpen && jobsFullPane}
        >
        <ErrorBoundary showDetails>
          <ChatInterface
            isActive={isActive}
            selectedProject={selectedProject}
            selectedSession={paneSession}
            ws={ws}
            sendMessage={sendMessage}
            onFileOpen={onFileOpen}
            onInputFocusChange={handleComposerFocusChange}
            onSessionProcessing={onSessionProcessing}
            onSessionIdle={onSessionIdle}
            processingSessions={processingSessions}
            onNavigateToSession={(targetSessionId: string) => {
              // The pane never changes the app URL; it swaps its own session.
              followLatestRef.current = true;
              setPaneSession((previous) =>
                previous?.id === targetSessionId
                  ? previous
                  : { id: targetSessionId, __provider: 'claude', origin: 'direct' },
              );
            }}
            onSessionEstablished={(targetSessionId: string, context) => {
              followLatestRef.current = true;
              setPaneSession((previous) =>
                previous?.id === targetSessionId
                  ? previous
                  : { id: targetSessionId, __provider: context.provider, origin: 'direct' },
              );
              void refreshRuns();
            }}
            onShowSettings={onShowSettings}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            sendByCtrlEnter={sendByCtrlEnter}
            newSessionTrigger={newSessionTrigger}
            onStartNewSession={handleNewWorkerSession}
            bootCommandName="/worker"
            sessionOrigin="direct"
            onRenderedSessionChange={setRenderedSessionId}
            holdQueuedFlush={isMobile && shellOpen && !jobsViewOpen}
          />
        </ErrorBoundary>
        </PaneShell>

        {/* Jobs list (ui14 job 1): a side column beside the transcript, or
            the whole pane where the pane is too narrow for both; the same
            rows, drawers, and footers either way. Opening a job's session
            keeps the column; the full-pane view swaps back to the transcript. */}
        {jobsViewOpen && (
          <div
            data-slot="jobs-view"
            data-layout={jobsFullPane ? 'pane' : 'column'}
            className={cn(
              'min-h-0 min-w-0 overflow-hidden',
              jobsFullPane ? 'flex-1' : 'w-60 max-w-[50%] flex-shrink-0 border-l border-border/60',
            )}
          >
            <JobsSidebar
              groups={jobGroups}
              activeSessionId={paneSession?.id ?? null}
              onOpenSession={(sessionId) => {
                handleOpenSession(sessionId);
                if (jobsFullPane) {
                  setJobsViewOpen(false);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
