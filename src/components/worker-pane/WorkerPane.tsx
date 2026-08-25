import { FileDiff, Hammer, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ChatInterface from '../chat/view/ChatInterface';
import ErrorBoundary from '../main-content/view/ErrorBoundary';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { authenticatedFetch } from '../../utils/api';
import { modelDisplayLabel } from '../../utils/modelLabels';
import { formatCompactAge } from '../sidebar/utils/utils';
import { ActionMenu, Badge, Button, Skeleton, Tooltip } from '../../shared/view/ui';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';
import type { Project, ProjectSession } from '../../types/app';

import PhaseNavigator, { type ChainSnapshot } from './PhaseNavigator';

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
 * Chain runs read "slug Phase N - name" from the dispatch manifest (never the
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
        ? `${run.chainSlug} Phase ${run.chainPhase} - ${name}`
        : `${run.chainSlug} Phase ${run.chainPhase}`;
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
 * (origin direct or dispatch), New Session boots /worker, and the header
 * surfaces the files the run touched since its base commit.
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

  const [paneSession, setPaneSession] = useState<ProjectSession | null>(null);
  const [runs, setRuns] = useState<WorkerRun[]>([]);
  // False until the first run fetch for this project settles; the switcher
  // and navigator hold their space with skeletons meanwhile (ui11 phase 11).
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [chains, setChains] = useState<Record<string, ChainSnapshot>>({});
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  const [touchedFiles, setTouchedFiles] = useState<string[] | null>(null);
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
    setTouchedFiles(null);
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
    setTouchedFiles(null);
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
    setTouchedFiles(null);
    setNewSessionTrigger((previous) => previous + 1);
  };

  const handleShowTouchedFiles = async () => {
    if (touchedFiles !== null) {
      setTouchedFiles(null);
      return;
    }
    const sessionId = paneSession?.id ?? latest?.sessionId;
    if (!sessionId) {
      return;
    }
    try {
      const response = await authenticatedFetch(
        `/api/providers/sessions/${encodeURIComponent(String(sessionId))}/touched-files`,
      );
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { data?: { files?: string[] } };
      setTouchedFiles(body.data?.files ?? []);
    } catch {
      setTouchedFiles([]);
    }
  };

  const selectedRun = runs.find((run) => run.sessionId === paneSession?.id) ?? null;
  const selectedChain = selectedRun?.chainSlug ? (chains[selectedRun.chainSlug] ?? null) : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Worker</span>
        {!runsLoaded && <Skeleton className="h-4 w-36 rounded-sm" />}
        {runsLoaded && runs.length > 0 && (
          <ActionMenu
            label={selectedRun ? runLabel(selectedRun, chains) : 'Runs'}
            ariaLabel="Switch worker run"
            align="left"
            variant="ghost"
            size="sm"
            className="min-w-0"
            triggerClassName="h-6 max-w-full gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground [&>span]:truncate [&_svg]:h-3 [&_svg]:w-3"
            menuClassName="w-72"
            items={runs.map((run) => ({
              key: run.sessionId,
              label: runLabel(run, chains),
              description: [run.origin, run.state, run.model && modelDisplayLabel(run.model)]
                .filter(Boolean)
                .join(' · '),
              // Same compact relative-date treatment as the sidebar rows; the
              // menu is transient, so render time is current enough.
              trailing: run.lastActivity ? formatCompactAge(run.lastActivity, new Date()) : undefined,
              onSelect: () => handleSelectRun(run),
            }))}
          />
        )}
        {/* No status badge in any run state (ui11 phase 10): state lives in
            the phase navigator and the run switcher. The two badges below are
            wiring fail-safes, not run status. */}
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
        <Tooltip content="Files touched since the run's base commit" position="bottom">
          <Button
            variant="ghost"
            size="sm"
            className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              void handleShowTouchedFiles();
            }}
            aria-label="Files touched by this run"
          >
            <FileDiff className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="New worker session (/worker)" position="bottom">
          <Button
            variant="ghost"
            size="sm"
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
      </div>

      {!runsLoaded ? (
        <div
          data-slot="phase-navigator-skeleton"
          aria-busy="true"
          className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-3"
        >
          <Skeleton className="h-3.5 w-3.5 rounded-sm" />
          <Skeleton className="h-3 w-24 rounded-sm" />
          <Skeleton className="h-3 w-40 rounded-sm" />
        </div>
      ) : selectedRun && (
        <PhaseNavigator
          chain={selectedChain}
          run={selectedChain ? null : { label: runLabel(selectedRun, chains), state: selectedRun.state }}
        />
      )}

      {touchedFiles !== null && (
        <div className="max-h-40 flex-shrink-0 overflow-y-auto border-b border-border/60 bg-muted/20 px-3 py-2">
          {touchedFiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No files changed since the run's base commit.</p>
          ) : (
            <ul className="space-y-0.5">
              {touchedFiles.map((file) => (
                <li key={file}>
                  <button
                    type="button"
                    className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-foreground hover:bg-accent/60"
                    onClick={() => onFileOpen?.(file)}
                    title={file}
                  >
                    {file}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
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
    </div>
  );
}
