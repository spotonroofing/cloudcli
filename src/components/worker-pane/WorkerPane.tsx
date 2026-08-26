import { Check, MessageSquare, Milestone, Plus, Terminal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ChatInterface from '../chat/view/ChatInterface';
import StandaloneShell from '../standalone-shell/view/StandaloneShell';
import ErrorBoundary from '../main-content/view/ErrorBoundary';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { authenticatedFetch } from '../../utils/api';
import { formatCompactAge } from '../sidebar/utils/utils';
import { cn } from '../../lib/utils';
import { ActionMenu, Badge, Button, Skeleton, Tooltip, type ActionMenuItem } from '../../shared/view/ui';
import { ActionSwapIcon } from '../../shared/view/beui';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';
import type { Project, ProjectSession } from '../../types/app';

import JobsSidebar, { jobProgress, type ChainSnapshot } from './JobsSidebar';

type WorkerRun = {
  sessionId: string;
  provider: string;
  origin: 'direct' | 'dispatch' | 'maintenance' | string | null;
  /** True when the run's first message was an auto-sent boot prompt. */
  booted?: boolean;
  chainSlug: string | null;
  /** 1-based unit index inside the dispatch chain; null outside chains. */
  chainPhase: number | null;
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
      return name
        ? `${run.chainSlug} Job ${run.chainPhase} - ${name}`
        : `${run.chainSlug} Job ${run.chainPhase}`;
    }
    return run.chainSlug;
  }
  return run.title || `run ${run.sessionId.slice(0, 8)}`;
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
};

/**
 * The always-there worker surface (spec B2): a full interactive chat pinned
 * beside the project's chats. It auto-follows the most recent worker session
 * (origin direct or dispatch), and the top bar is just the run's name (the
 * run-list menu) and the jobs count (the jobs-view toggle) — ui13 job 10.
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
}: WorkerPaneProps) {
  const { subscribe, isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;
  const { isMobile } = useDeviceSettings({ trackPWA: false });

  // Jobs as a switcher view (ui13 job 10): the pane swaps between the
  // transcript and a full-pane jobs list behind the top bar's jobs count.
  // Strictly per pane/project — never persisted, never shared across projects.
  const [jobsViewOpen, setJobsViewOpen] = useState(false);
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

  const projectPath = selectedProject.fullPath || selectedProject.path || '';

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
    setJobsViewOpen(false);
    followLatestRef.current = true;
    void refreshRuns();
  }, [refreshRuns]);

  // Watcher deltas plus a slow poll keep the run list and its states honest
  // even when a dispatched chain starts sessions with no browser involved.
  // chain_progress is the watchdog streaming per-phase progress: merge the
  // snapshot for an instant navigator update, then refetch to reconcile runs.
  useEffect(() => {
    const unsubscribe = subscribe?.((event: { kind?: string; chain?: ChainSnapshot } | null) => {
      if (event?.kind === 'session_upserted') {
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
  }, [subscribe, refreshRuns, projectPath]);

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
  const selectedChain = selectedRun?.chainSlug ? (chains[selectedRun.chainSlug] ?? null) : null;

  // Jobs are the navigation (ui13 job 2): which chain units have sessions to
  // open, which unit the pane is showing, and the project's other runs for
  // cross-run jumps — routed through handleSelectRun so pin/auto-follow
  // semantics hold.
  const chainRuns = selectedChain
    ? runs.filter((run) => run.chainSlug === selectedChain.slug && run.chainPhase != null)
    : [];
  const openableJobs = selectedChain
    ? chainRuns.map((run) => run.chainPhase as number)
    : selectedRun
      ? [1]
      : [];
  const activeJob = selectedRun ? (selectedChain ? selectedRun.chainPhase : 1) : null;
  const handleOpenJob = (jobIndex: number) => {
    const target = selectedChain
      ? chainRuns.find((run) => run.chainPhase === jobIndex)
      : selectedRun;
    if (target) {
      handleSelectRun(target);
    }
  };
  const otherRuns = runs
    .filter((run) =>
      selectedChain ? run.chainSlug !== selectedChain.slug : run.sessionId !== selectedRun?.sessionId,
    )
    .map((run) => ({
      sessionId: run.sessionId,
      label: runLabel(run, chains),
      // Same compact relative-date treatment as the sidebar rows; render
      // time is current enough for a slow-moving list.
      age: run.lastActivity ? formatCompactAge(run.lastActivity, new Date()) : null,
    }));
  const handleSelectRunId = (sessionId: string) => {
    const target = runs.find((run) => run.sessionId === sessionId);
    if (target) {
      handleSelectRun(target);
    }
  };

  // The run list behind the run's name (ui13 job 10): the retired dropdown's
  // one remaining function — every run of the project, newest first, plus the
  // New-session flow that left the bar.
  const runListItems: ActionMenuItem[] = [
    {
      key: 'new-session',
      label: 'New worker session',
      icon: Plus,
      onSelect: handleNewWorkerSession,
    },
    ...runs.map((run, index) => ({
      key: run.sessionId,
      label: runLabel(run, chains),
      icon: run.sessionId === selectedRun?.sessionId ? Check : MessageSquare,
      trailing: run.lastActivity ? formatCompactAge(run.lastActivity, new Date()) : undefined,
      showDividerBefore: index === 0,
      onSelect: () => handleSelectRun(run),
    })),
  ];

  const progress = jobProgress(selectedChain);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Worker top bar (ui13 job 10, Willem-approved): the run's name on the
          left (opens the run list), the jobs count on the right (toggles the
          jobs view). No status words; the two badges are wiring fail-safes. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-2 py-1.5">
        {!runsLoaded && <Skeleton className="h-4 w-36 rounded-sm" />}
        {runsLoaded && (
          <div data-slot="worker-run-name" className="min-w-0">
            <ActionMenu
              label={selectedRun ? runLabel(selectedRun, chains) : 'Worker'}
              ariaLabel="Run list"
              variant="ghost"
              size="sm"
              align="left"
              items={runListItems}
              className="max-w-full"
              triggerClassName="h-6 max-w-full min-w-0 justify-start gap-1 px-1.5 text-xs font-medium text-foreground hover:bg-accent/60 [&>span]:min-w-0 [&>span]:truncate [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:flex-shrink-0 [&>svg]:text-muted-foreground"
              menuClassName="max-w-[320px]"
            />
          </div>
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
        {runsLoaded && selectedRun && (
          <button
            type="button"
            data-slot="worker-jobs-toggle"
            aria-pressed={jobsViewOpen}
            aria-label={jobsViewOpen ? 'Show transcript' : 'Show jobs'}
            onClick={() => setJobsViewOpen((open) => !open)}
            className={cn(
              'touch-hit relative flex h-6 flex-shrink-0 items-center gap-1.5 rounded px-1.5 text-xs font-medium tabular-nums transition-colors hover:bg-accent/60 hover:text-foreground',
              jobsViewOpen ? 'bg-accent/60 text-foreground' : 'text-muted-foreground',
            )}
          >
            <Milestone className="h-3.5 w-3.5" />
            Job {progress.ordinal} of {progress.total}
          </button>
        )}
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
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 min-w-0 flex-1 ${(isMobile && shellOpen) || jobsViewOpen ? 'hidden' : ''}`}
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
            onSessionEstablished={(targetSessionId: string) => {
              followLatestRef.current = true;
              setPaneSession((previous) =>
                previous?.id === targetSessionId
                  ? previous
                  : { id: targetSessionId, __provider: 'claude', origin: 'direct' },
              );
              void refreshRuns();
            }}
            onShowSettings={onShowSettings}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            sendByCtrlEnter={sendByCtrlEnter}
            newSessionTrigger={newSessionTrigger}
            bootCommandName="/worker"
            sessionOrigin="direct"
            onRenderedSessionChange={setRenderedSessionId}
            onShowAllTasks={null}
          />
        </ErrorBoundary>
        </div>

        {isMobile && shellOpen && !jobsViewOpen && (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="pane-shell">
            <StandaloneShell
              project={selectedProject}
              session={paneSession}
              showHeader={false}
              isActive
            />
          </div>
        )}

        {/* Full-pane jobs view (ui13 job 10): the same job rows, drawers, and
            Other-runs footer the sidebar carried, now a switcher view inside
            the pane; navigating a job swaps back to the transcript. */}
        {jobsViewOpen && selectedRun && (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="jobs-view">
            <JobsSidebar
              chain={selectedChain}
              run={selectedChain ? null : { label: runLabel(selectedRun, chains), state: selectedRun.state }}
              activeJob={activeJob}
              openableJobs={openableJobs}
              onOpenJob={(jobIndex) => {
                handleOpenJob(jobIndex);
                setJobsViewOpen(false);
              }}
              otherRuns={otherRuns}
              onSelectRun={(sessionId) => {
                handleSelectRunId(sessionId);
                setJobsViewOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
