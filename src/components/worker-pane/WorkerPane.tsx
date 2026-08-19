import { FileDiff, Hammer, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ChatInterface from '../chat/view/ChatInterface';
import ErrorBoundary from '../main-content/view/ErrorBoundary';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { authenticatedFetch } from '../../utils/api';
import { Button, Tooltip } from '../../shared/view/ui';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../hooks/useSessionProtection';
import type { Project, ProjectSession } from '../../types/app';

type WorkerLatestSession = {
  sessionId: string;
  provider: string;
  origin: 'direct' | 'dispatch' | string | null;
  baseCommit: string | null;
  sessionTitle: string;
  lastActivity: string | null;
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
}: WorkerPaneProps) {
  const { subscribe } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const [paneSession, setPaneSession] = useState<ProjectSession | null>(null);
  const [latest, setLatest] = useState<WorkerLatestSession | null>(null);
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);
  const [touchedFiles, setTouchedFiles] = useState<string[] | null>(null);
  // Auto-follow pauses while the user is composing a brand-new pane session,
  // so a dispatched run landing mid-thought cannot steal the surface.
  const followLatestRef = useRef(true);

  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  const refreshLatest = useCallback(async () => {
    if (!projectPath) {
      return;
    }
    try {
      const response = await authenticatedFetch(
        `/api/providers/sessions/worker-latest?projectPath=${encodeURIComponent(projectPath)}`,
      );
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { data?: { session?: WorkerLatestSession | null } };
      setLatest(body.data?.session ?? null);
    } catch {
      // transient; the poll retries
    }
  }, [projectPath]);

  // Project switch: reset and re-resolve which worker session to follow.
  useEffect(() => {
    setPaneSession(null);
    setTouchedFiles(null);
    followLatestRef.current = true;
    void refreshLatest();
  }, [refreshLatest]);

  // Watcher deltas plus a slow poll keep "most recent worker session" honest
  // even when a dispatched chain starts sessions with no browser involved.
  useEffect(() => {
    const unsubscribe = subscribe?.((event: { kind?: string } | null) => {
      if (event?.kind === 'session_upserted') {
        void refreshLatest();
      }
    });
    const interval = setInterval(() => {
      void refreshLatest();
    }, 20_000);
    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [subscribe, refreshLatest]);

  useEffect(() => {
    if (!latest || !followLatestRef.current || paneSession?.id === latest.sessionId) {
      return;
    }
    setPaneSession({
      id: latest.sessionId,
      __provider: (latest.provider || 'claude') as ProjectSession['__provider'],
      summary: latest.sessionTitle,
      origin: latest.origin ?? null,
    });
  }, [latest, paneSession?.id]);

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

  const originLabel = paneSession?.id === latest?.sessionId ? latest?.origin ?? null : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Worker</span>
        {originLabel && (
          <span className="rounded-full border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {originLabel}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {paneSession?.summary || ''}
        </span>
        <Tooltip content="Files touched since the run's base commit" position="bottom">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
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
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={handleNewWorkerSession}
            aria-label="New worker session"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Hide worker pane"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

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
            onInputFocusChange={onInputFocusChange}
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
              void refreshLatest();
            }}
            onShowSettings={onShowSettings}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            sendByCtrlEnter={sendByCtrlEnter}
            newSessionTrigger={newSessionTrigger}
            bootCommandName="/worker"
            sessionOrigin="direct"
            onShowAllTasks={null}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
