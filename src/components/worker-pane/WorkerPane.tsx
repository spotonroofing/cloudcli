import { Hammer, Milestone, Plus, X } from 'lucide-react';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import ChatInterface from '../chat/view/ChatInterface';
import ChatExportButton from '../chat/view/subcomponents/ChatExportButton';
import { ChatExportProvider } from '../chat/state/chatExportTarget';
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
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';
import type { Project, ProjectSession, WorkerSessionRequest } from '../../types/app';
import { titleFromPrompt } from '../../../shared/sessionTitle.js';
import { workerRunLabel } from '../../utils/workerRunLabel';
import { preserveJsonEqual } from '../../utils/preserveEqual';

import JobsSidebar, {
  ChainFastModeToggle,
  JOBS_COLUMN_BASIS,
  type ChainSnapshot,
  type JobGroup,
} from './JobsSidebar';
import {
  findWorkerFollowTarget,
  preserveWorkerSessionSelection,
  sessionUpsertNeedsRunRefresh,
  shouldFollowWorkerRun,
  workerSessionPinUntil,
} from './workerRunFollow';

const JOBS_VIEW_PREFERENCE_KEY = 'worker-jobs-view-open-v1';

type JobsViewPreferences = Record<string, boolean>;

const readJobsViewPreferences = (): JobsViewPreferences => {
  try {
    const stored = JSON.parse(localStorage.getItem(JOBS_VIEW_PREFERENCE_KEY) || '{}') as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    );
  } catch {
    return {};
  }
};

const readJobsViewPreference = (projectId: string, legacyProjectPath: string): boolean => {
  const stored = readJobsViewPreferences();
  if (typeof stored[projectId] === 'boolean') {
    return stored[projectId];
  }
  return legacyProjectPath ? stored[legacyProjectPath] === true : false;
};

const persistJobsViewPreference = (
  projectId: string,
  legacyProjectPath: string,
  open: boolean,
): void => {
  const next = { ...readJobsViewPreferences(), [projectId]: open };
  // Job 0 persisted path keys. Migrate the touched project to its stable DB
  // id so moving or renaming the folder cannot transfer the preference.
  if (legacyProjectPath && legacyProjectPath !== projectId) {
    delete next[legacyProjectPath];
  }
  writeSetting(JOBS_VIEW_PREFERENCE_KEY, JSON.stringify(next));
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
  /** Honest run start; used for chain-less labels and history grouping. */
  startedAt: number | string | null;
  /** Whole-session token cost from the provider transcript or rollout. */
  tokenCount: number | null;
};

/**
 * Chain runs read "slug Job N - name" from the dispatch manifest. Chain-less
 * runs use kind, short model, and Eastern start time, never prompt or id text.
 */
const runLabel = (run: WorkerRun, chains: Record<string, ChainSnapshot>): string => {
  // Monday maintenance runs are a system kind, labeled as such (spec B9).
  if (run.origin === 'maintenance') {
    return workerRunLabel(run);
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
  return workerRunLabel(run);
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
  onSessionViewed?: (sessionId: string) => void;
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
  /** Reports this project's persisted jobs state to its outer pane strip. */
  onJobsViewOpenChange?: (open: boolean) => void;
  /** Phone only (ui14 job 11): the top bar opens the sidebar and carries the window selector. */
  onMenuClick?: () => void;
  windowSelector?: ReactNode;
  /** Phone only (ui17 job 8): the Shell taskbar segment is the active one. */
  shellOpen?: boolean;
  /** A session the app asks this pane to show (the footer activity drawer). */
  requestedSession?: WorkerSessionRequest | null;
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
  onSessionViewed,
  onShowSettings,
  onClose,
  closeLabel,
  jobsTakeover = false,
  onJobsViewOpenChange,
  onMenuClick,
  windowSelector,
  shellOpen = false,
  requestedSession = null,
}: WorkerPaneProps) {
  const { subscribe, isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const projectId = selectedProject.projectId;
  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  // Jobs behind the top bar's job sign (ui14 job 1): a side column beside the
  // transcript, or the whole pane where the pane is too narrow for both — at
  // three or more projects in column layout, and on phones. The cloud-synced
  // record is keyed by project, so reloads and other devices restore the same
  // view without one project's choice leaking into another.
  const [jobsViewOpen, setJobsViewOpenState] = useState(
    () => readJobsViewPreference(projectId, projectPath),
  );
  const setJobsViewOpen = useCallback((value: boolean | ((open: boolean) => boolean)) => {
    setJobsViewOpenState((previous) => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (projectId) persistJobsViewPreference(projectId, projectPath, next);
      return next;
    });
  }, [projectId, projectPath]);
  const [paneSession, setPaneSession] = useState<ProjectSession | null>(null);
  const [runs, setRuns] = useState<WorkerRun[]>([]);
  const knownRunIdsRef = useRef<ReadonlySet<string>>(new Set());
  knownRunIdsRef.current = new Set(runs.map((run) => run.sessionId));
  // False until the first run fetch for this project settles; the top bar
  // holds its space with a skeleton meanwhile (ui11 phase 11).
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [chains, setChains] = useState<Record<string, ChainSnapshot>>({});
  const [fastModePendingSlug, setFastModePendingSlug] = useState<string | null>(null);
  const [fastModeHintSlug, setFastModeHintSlug] = useState<string | null>(null);
  const fastModeHintSeenRef = useRef<Set<string>>(new Set());
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  // An explicit selection pins that session for one minute. After that short
  // grace period, every newly announced build takes the pane again; verifier
  // sessions remain navigation-only and never become automatic targets.
  const [manualPinUntil, setManualPinUntil] = useState(0);
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
    setJobsViewOpenState(readJobsViewPreference(projectId, projectPath));
    return onSettingChange([JOBS_VIEW_PREFERENCE_KEY], () => {
      setJobsViewOpenState(readJobsViewPreference(projectId, projectPath));
    });
  }, [projectId, projectPath]);

  useEffect(() => {
    if (!fastModeHintSlug) return;
    const timer = setTimeout(() => setFastModeHintSlug(null), 4_000);
    return () => clearTimeout(timer);
  }, [fastModeHintSlug]);

  useEffect(() => {
    onJobsViewOpenChange?.(jobsViewOpen);
  }, [jobsViewOpen, onJobsViewOpenChange]);

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
      // A live run can change while the user is sweeping a 100+ row history.
      // Keep that network reconciliation interruptible so pointer and wheel
      // input retain the main-thread budget even when the payload is new.
      startTransition(() => {
        setRuns((previous) => preserveJsonEqual(previous, body.data?.runs ?? []));
        setChains((previous) => preserveJsonEqual(previous, body.data?.chains ?? {}));
      });
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
    setManualPinUntil(0);
    void refreshRuns();
  }, [refreshRuns]);

  // The server sorts worker runs newest-first. Verifier rows remain in the
  // jobs navigator but never become the pane's implicit follow target.
  const followTarget = useMemo(() => findWorkerFollowTarget(runs), [runs]);
  const runsRef = useRef<WorkerRun[]>(runs);
  runsRef.current = runs;
  const followTargetRef = useRef<WorkerRun | null>(followTarget);
  followTargetRef.current = followTarget;

  // A visible worker transcript counts as seen. Including the processing map
  // makes the completion render clear a response mark that may have landed in
  // the same websocket turn, without waiting for another navigation.
  useEffect(() => {
    if (isActive && paneSession?.id) onSessionViewed?.(String(paneSession.id));
  }, [isActive, paneSession?.id, processingSessions, onSessionViewed]);

  // Watcher deltas plus a slow poll keep the run list and its states honest
  // even when a dispatched chain starts sessions with no browser involved.
  // chain_progress is the watchdog streaming per-phase progress: merge the
  // snapshot for an instant navigator update, then refetch to reconcile runs.
  useEffect(() => {
    const unsubscribe = subscribe?.((event: {
      kind?: string;
      sessionId?: string;
      chain?: ChainSnapshot;
      project?: { projectId?: string } | null;
    } | null) => {
      // Only this project's sessions can change its run list (ui13 job 15):
      // another project's transcript writes used to refetch every open pane.
      if (
        event?.kind === 'session_upserted'
        && event.project?.projectId === selectedProject.projectId
        && sessionUpsertNeedsRunRefresh(event.sessionId ?? null, knownRunIdsRef.current)
      ) {
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

  useEffect(() => {
    const remaining = manualPinUntil - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setManualPinUntil(0), remaining);
    return () => clearTimeout(timer);
  }, [manualPinUntil]);

  // Auto-follow: every new build session takes the pane unless the user made
  // an explicit selection in the last minute. Verifier sessions are removed
  // by findWorkerFollowTarget before this decision is made.
  useEffect(() => {
    if (!followTarget || !shouldFollowWorkerRun(followTarget, paneSession?.id ?? null, manualPinUntil)) {
      return;
    }
    setPaneSession((previous) => preserveWorkerSessionSelection(previous, {
      id: followTarget.sessionId,
      __provider: (followTarget.provider || 'claude') as ProjectSession['__provider'],
      summary: followTarget.title ?? undefined,
      origin: followTarget.origin ?? null,
      booted: Boolean(followTarget.booted),
    }));
  }, [followTarget, paneSession?.id, manualPinUntil]);

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  const handleSelectRun = useCallback((run: WorkerRun) => {
    // Picking the current build/direct target resumes immediate follow; an
    // older run or verifier is an intentional one-minute pin.
    setManualPinUntil(workerSessionPinUntil(run, followTarget));
    setPaneSession((previous) =>
      preserveWorkerSessionSelection(previous, {
        id: run.sessionId,
        __provider: (run.provider || 'claude') as ProjectSession['__provider'],
        summary: run.title ?? undefined,
        origin: run.origin ?? null,
        booted: Boolean(run.booted),
      }),
    );
  }, [followTarget]);

  // A worker row tapped in the sidebar's activity drawer lands here on the
  // phone (ui17 job 8) instead of the planner pane. The run list may not have
  // arrived yet, so the request builds its own pane session; the pin keeps a
  // newly announced build from taking the pane out from under the tap.
  const requestToken = requestedSession?.token ?? 0;
  useEffect(() => {
    if (!requestedSession) {
      return;
    }
    const run = runsRef.current.find((candidate) => candidate.sessionId === requestedSession.sessionId);
    setManualPinUntil(workerSessionPinUntil(run ?? null, followTargetRef.current));
    setPaneSession((previous) =>
      preserveWorkerSessionSelection(previous, {
        id: requestedSession.sessionId,
        __provider: (run?.provider || requestedSession.provider || 'claude') as ProjectSession['__provider'],
        summary: run?.title ?? undefined,
        origin: run?.origin ?? 'direct',
        booted: Boolean(run?.booted),
      }),
    );
    // The token is the request; re-running on a run-list refresh would undo a
    // later manual selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestToken]);

  const handleNewWorkerSession = () => {
    setManualPinUntil(workerSessionPinUntil(null, followTarget));
    setPaneSession(null);
    setJobsViewOpen(false);
    setNewSessionTrigger((previous) => previous + 1);
  };

  const handleToggleChainFastMode = useCallback(async (slug: string, enabled: boolean) => {
    setFastModePendingSlug(slug);
    try {
      const response = await authenticatedFetch(`/api/watchdog/chains/${encodeURIComponent(slug)}/fast`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, fastMode: enabled }),
      });
      if (!response.ok) {
        throw new Error(`Fast mode route returned ${response.status}`);
      }
      const body = await response.json() as { data?: { fastMode?: boolean } };
      const fastMode = typeof body.data?.fastMode === 'boolean' ? body.data.fastMode : enabled;
      setChains((previous) => {
        const chain = previous[slug];
        return chain ? { ...previous, [slug]: { ...chain, fastMode } } : previous;
      });
      if (fastMode && !fastModeHintSeenRef.current.has(slug)) {
        fastModeHintSeenRef.current.add(slug);
        setFastModeHintSlug(slug);
      } else if (!fastMode) {
        setFastModeHintSlug((current) => current === slug ? null : current);
      }
    } catch (error) {
      console.error('Unable to change chain fast mode:', error);
    } finally {
      setFastModePendingSlug((current) => current === slug ? null : current);
    }
  }, [projectPath]);

  const selectedRun = runs.find((run) => run.sessionId === paneSession?.id) ?? null;
  // The title after "Worker" (ui14 job 2), in the planner header's style: the
  // run's own session title, else the chain label ("slug Job N - name"); a
  // fresh, unsent pane session has none yet.
  const paneTitle = selectedRun
    ? (titleFromPrompt(selectedRun.title) || runLabel(selectedRun, chains))
    : titleFromPrompt(paneSession?.summary);
  const followedChain = selectedRun?.chainSlug
    ? chains[selectedRun.chainSlug] ?? null
    : null;
  const followedActiveChain = followedChain?.status === 'running' || followedChain?.status === 'paused'
    ? followedChain
    : null;

  // Explicit job-row chat controls are the navigation (ui16 job 2), and the list spans every run of the
  // project (ui14 job 1): each chain is a group carrying the sessions its
  // units have, each chain-less run is a one-row group, newest first. Every
  // selection routes through handleSelectRun so pin/auto-follow holds.
  const jobGroups = useMemo<JobGroup[]>(() => [
    ...Object.values(chains).map((chain) => {
      const sessions: Record<number, string> = {};
      const tokenCounts: Record<number, number | null> = {};
      // The job row opens the build session; the verify session (ui14 job
      // 10) is reached from the drawer's verify row instead.
      for (const run of runs) {
        if (run.chainSlug === chain.slug && run.chainPhase != null && run.chainStage !== 'verify') {
          sessions[run.chainPhase] = run.sessionId;
          tokenCounts[run.chainPhase] = run.tokenCount;
        }
      }
      return { chain, run: null, sessions, tokenCounts, startedAt: chain.startedAt };
    }),
    ...runs
      .filter((run) => !run.chainSlug)
      .map((run) => ({
        chain: null,
        run: { label: runLabel(run, chains), state: run.state },
        sessions: { 1: run.sessionId },
        tokenCounts: { 1: run.tokenCount },
        startedAt: typeof run.startedAt === 'number'
          ? run.startedAt
          : run.startedAt ? Date.parse(run.startedAt) : 0,
      })),
  ].sort((a, b) => b.startedAt - a.startedAt), [chains, runs]);
  const handleOpenSession = useCallback((sessionId: string) => {
    const target = runs.find((run) => run.sessionId === sessionId);
    if (target) {
      handleSelectRun(target);
    }
  }, [handleSelectRun, runs]);
  const jobsFullPane = jobsTakeover || isMobile;
  // The phone's Shell segment (ui17 job 8) takes the whole pane: the jobs
  // takeover steps aside for it and comes back on the Worker segment.
  const shellSegmentOpen = isMobile && shellOpen;
  const handleOpenJobSession = useCallback((sessionId: string) => {
    handleOpenSession(sessionId);
    if (jobsFullPane) setJobsViewOpen(false);
  }, [handleOpenSession, jobsFullPane, setJobsViewOpen]);

  return (
    <ChatExportProvider>
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
        {followedActiveChain && (
          <ChainFastModeToggle
            chain={followedActiveChain}
            pending={fastModePendingSlug === followedActiveChain.slug}
            showHint={fastModeHintSlug === followedActiveChain.slug}
            onToggle={handleToggleChainFastMode}
          />
        )}
        {isMobile && windowSelector}
        <ChatExportButton />
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
          open={shellSegmentOpen}
          busy={Boolean(paneSession && processingSessions?.has(String(paneSession.id)))}
          hidden={jobsViewOpen && jobsFullPane && !shellSegmentOpen}
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
              const targetRun = runs.find((run) => run.sessionId === targetSessionId) ?? null;
              setManualPinUntil(workerSessionPinUntil(targetRun, followTarget));
              setPaneSession((previous) =>
                preserveWorkerSessionSelection(previous, {
                  id: targetSessionId,
                  __provider: (targetRun?.provider || previous?.__provider || 'claude') as ProjectSession['__provider'],
                  origin: targetRun?.origin ?? previous?.origin ?? 'direct',
                }),
              );
            }}
            onSessionEstablished={(targetSessionId: string, context) => {
              setManualPinUntil(0);
              setPaneSession((previous) =>
                preserveWorkerSessionSelection(previous, {
                  id: targetSessionId,
                  __provider: context.provider,
                  origin: 'direct',
                }),
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
            holdQueuedFlush={shellSegmentOpen}
          />
        </ErrorBoundary>
        </PaneShell>

        {/* Jobs list (ui14 job 1): a side column beside the transcript, or
            the whole pane where the pane is too narrow for both; the same
            rows, drawers, and footers either way. Opening a job's explicit chat control
            keeps the column; the full-pane view swaps back to the transcript. */}
        {jobsViewOpen && !shellSegmentOpen && (
          <div
            data-slot="jobs-view"
            data-layout={jobsFullPane ? 'pane' : 'column'}
            className={cn(
              'min-h-0 min-w-0 overflow-hidden',
              jobsFullPane ? 'flex-1' : 'flex-shrink-0 border-l border-border/60',
            )}
            style={jobsFullPane ? undefined : { width: JOBS_COLUMN_BASIS }}
          >
            <JobsSidebar
              groups={jobGroups}
              loading={!runsLoaded}
              activeSessionId={paneSession?.id ?? null}
              onOpenSession={handleOpenJobSession}
              onToggleFastMode={handleToggleChainFastMode}
              fastModePendingSlug={fastModePendingSlug}
              fastModeHintSlug={fastModeHintSlug}
            />
          </div>
        )}
      </div>
    </div>
    </ChatExportProvider>
  );
}
