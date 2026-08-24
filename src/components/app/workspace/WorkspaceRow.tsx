import { Columns2, Compass, Folder, GripVertical, Hammer, Plus, Rows2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import WorkerPane from '../../worker-pane/WorkerPane';
import ErrorBoundary from '../../main-content/view/ErrorBoundary';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { Badge, Button, Tooltip } from '../../../shared/view/ui';
import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionEstablishedContext, SessionNavigationOptions } from '../../chat/types/types';
import type { SettingsMainTab } from '../../settings/types/types';

import type { WorkspaceMode } from './useWorkspace';

export type WorkspaceGripHandlers = {
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerMove: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
};

type WorkspaceRowProps = {
  project: Project;
  /** True for the URL-driven row (the app's selected project/session). */
  isPrimary: boolean;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  mode: WorkspaceMode;
  /** Planner fraction of this row's width. */
  split: number;
  onSplitChange: (fraction: number) => void;
  gripHandlers: WorkspaceGripHandlers;
  onToggleLayout: () => void;
  onCloseRow: () => void;
  /** New Session flow for the primary row (global trigger + root navigation). */
  onNewPrimarySession: () => void;
  selectedSession: ProjectSession | null;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onInputFocusChange: (focused: boolean) => void;
  onSessionProcessing: MarkSessionProcessing;
  onSessionIdle: MarkSessionIdle;
  processingSessions: SessionActivityMap;
  onShowSettings: (tab?: SettingsMainTab) => void;
};

const normalizeSession = (session: ProjectSession): ProjectSession => ({
  ...session,
  __provider: (session.__provider ?? session.provider ?? 'claude') as LLMProvider,
});

/**
 * One open project in the multi-project workspace: its planner chat and its
 * worker pane side by side, sharing the workspace's split geometry so
 * planners align over planners across rows. The primary row renders the
 * URL-driven session; every other row manages its own planner session,
 * following the project's most recent planner chat until the user starts a
 * fresh one.
 */
export default function WorkspaceRow({
  project,
  isPrimary,
  ws,
  sendMessage,
  mode,
  split,
  onSplitChange,
  gripHandlers,
  onToggleLayout,
  onCloseRow,
  onNewPrimarySession,
  selectedSession,
  externalMessageUpdate,
  newSessionTrigger,
  onNavigateToSession,
  onSessionEstablished,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onShowSettings,
}: WorkspaceRowProps) {
  const { isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  // Non-primary rows manage their own planner session, WorkerPane-style: the
  // pane never changes the app URL.
  const [localSession, setLocalSession] = useState<ProjectSession | null>(null);
  const startedFreshRef = useRef(false);

  const latestPlannerSession = useMemo(() => {
    const sessions = project.sessions ?? [];
    return (
      sessions.find((session) => {
        const origin = (session.origin as string | null) ?? null;
        return origin === 'planner' || origin === null;
      }) ?? null
    );
  }, [project.sessions]);

  // Adopt the project's most recent planner chat once it is known; never
  // swap a session the row is already showing.
  useEffect(() => {
    if (isPrimary || startedFreshRef.current || !latestPlannerSession) {
      return;
    }
    setLocalSession((previous) => previous ?? normalizeSession(latestPlannerSession));
  }, [isPrimary, latestPlannerSession]);

  // What the row displayed while primary, so handing the primary slot to
  // another row keeps this pane's content instead of yanking it to the
  // project's latest planner chat. Guarded by owning project because a
  // deep-linked session briefly renders here before the selection catches up.
  const lastPrimarySessionRef = useRef<ProjectSession | null>(null);
  useEffect(() => {
    if (
      isPrimary
      && selectedSession
      && (!selectedSession.__projectId || selectedSession.__projectId === project.projectId)
    ) {
      lastPrimarySessionRef.current = selectedSession;
    }
  }, [isPrimary, selectedSession, project.projectId]);

  const prevPrimaryRef = useRef(isPrimary);
  useEffect(() => {
    if (prevPrimaryRef.current === isPrimary) {
      return;
    }
    const wasPrimary = prevPrimaryRef.current;
    prevPrimaryRef.current = isPrimary;
    if (wasPrimary && lastPrimarySessionRef.current) {
      setLocalSession(lastPrimarySessionRef.current);
    }
  }, [isPrimary]);

  // Per-row New Session trigger, monotonic for this pane. Global New Session
  // bumps flow in only while the row is primary; a promotion or demotion by
  // itself never changes the value — the mounted ChatInterface would read any
  // trigger change as a New Session intent and fire a spurious /planner boot.
  const [rowTrigger, setRowTrigger] = useState(0);
  const globalTriggerRef = useRef(newSessionTrigger);
  useEffect(() => {
    const changed = newSessionTrigger !== globalTriggerRef.current;
    globalTriggerRef.current = newSessionTrigger;
    if (isPrimary && changed) {
      lastPrimarySessionRef.current = null;
      setLocalSession(null);
      setRowTrigger((previous) => previous + 1);
    }
  }, [isPrimary, newSessionTrigger]);

  // Primary shows the URL-driven session; with none selected (e.g. right
  // after this row was handed the primary slot) it keeps its own session
  // rather than clearing — a real New Session intent clears localSession
  // through the trigger effect above.
  const plannerSession = isPrimary ? selectedSession ?? localSession : localSession;
  const sessionTitle = (plannerSession?.summary || plannerSession?.title || '').trim();
  // Honesty rule from phase 2: a worker-origin session (deep link) never
  // renders under a Planner label.
  const paneIsWorkerSession =
    plannerSession?.origin === 'direct'
    || plannerSession?.origin === 'dispatch'
    || plannerSession?.origin === 'external'
    || plannerSession?.origin === 'maintenance';

  // Fail-safes, mirroring the single-project pane headers: socket down, or
  // the rendered transcript diverging from the session the header claims.
  const [renderedSessionId, setRenderedSessionId] = useState<string | null>(null);
  const [streamMismatch, setStreamMismatch] = useState(false);
  const claimedSessionId = plannerSession?.id ?? null;
  useEffect(() => {
    if (!renderedSessionId || !claimedSessionId || renderedSessionId === claimedSessionId) {
      setStreamMismatch(false);
      return;
    }
    const timer = setTimeout(() => setStreamMismatch(true), 2000);
    return () => clearTimeout(timer);
  }, [renderedSessionId, claimedSessionId]);

  const handleNewSession = () => {
    if (isPrimary) {
      // Global flow: bumps the app trigger, which the effect above folds
      // into rowTrigger and clears the fallback session.
      onNewPrimarySession();
      return;
    }
    startedFreshRef.current = true;
    setLocalSession(null);
    setRowTrigger((previous) => previous + 1);
  };

  // Planner/worker divider drag; the workspace clamps and (in rows mode)
  // shares the fraction across every row.
  const rowRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef(false);
  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    splitDragRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current || !rowRef.current) {
      return;
    }
    const rect = rowRef.current.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    onSplitChange((event.clientX - rect.left) / rect.width);
  };
  const handleSplitPointerEnd = () => {
    splitDragRef.current = false;
  };

  return (
    <div ref={rowRef} className="flex h-full min-w-0">
      <div
        className="flex min-h-0 min-w-[200px] flex-col overflow-hidden"
        style={{ flex: `0 1 ${split * 100}%` }}
        data-workspace-pane="planner"
      >
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
          <button
            type="button"
            {...gripHandlers}
            className="-ml-1 flex h-6 w-6 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:cursor-grabbing"
            title="Drag to rearrange"
            aria-label={`Move ${project.displayName}`}
            data-workspace-grip={project.projectId}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          {project.iconDataUrl ? (
            <img src={project.iconDataUrl} alt="" className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] object-contain" />
          ) : (
            <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{project.displayName}</span>
          {paneIsWorkerSession ? (
            <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <Compass className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground">
            {paneIsWorkerSession ? 'Worker' : 'Planner'}
          </span>
          {sessionTitle && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{sessionTitle}</span>
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
          <Tooltip content="New planner session" position="bottom">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={handleNewSession}
              aria-label="New planner session"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={mode === 'rows' ? 'Column layout' : 'Row layout'} position="bottom">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleLayout}
              aria-label={mode === 'rows' ? 'Switch to column layout' : 'Switch to row layout'}
              data-workspace-layout-toggle
            >
              {mode === 'rows' ? <Columns2 className="h-3.5 w-3.5" /> : <Rows2 className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1">
          <ErrorBoundary showDetails>
            <ChatInterface
              isActive
              selectedProject={project}
              selectedSession={plannerSession}
              ws={ws}
              sendMessage={sendMessage}
              onInputFocusChange={onInputFocusChange}
              onSessionProcessing={onSessionProcessing}
              onSessionIdle={onSessionIdle}
              processingSessions={processingSessions}
              onNavigateToSession={(targetSessionId, options) => {
                if (isPrimary) {
                  onNavigateToSession(targetSessionId, options);
                  return;
                }
                setLocalSession((previous) =>
                  previous?.id === targetSessionId
                    ? previous
                    : { id: targetSessionId, __provider: 'claude', origin: 'planner' },
                );
              }}
              onSessionEstablished={(sessionId, context) => {
                const established: ProjectSession = {
                  id: sessionId,
                  __provider: context.provider,
                  origin: context.origin ?? 'planner',
                  summary: context.summary ?? undefined,
                };
                setLocalSession((previous) => (previous?.id === sessionId ? previous : established));
                if (isPrimary) {
                  lastPrimarySessionRef.current = established;
                  onSessionEstablished(sessionId, context);
                }
                // Extra rows never call the app-level handler: it replaces the
                // global selectedSession, which would hijack the primary pane.
                // The sidebar row arrives through the session_upserted watcher,
                // same as WorkerPane sessions.
              }}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={isPrimary ? externalMessageUpdate : undefined}
              newSessionTrigger={rowTrigger}
              sessionOrigin="planner"
              onRenderedSessionChange={setRenderedSessionId}
              onShowAllTasks={null}
            />
          </ErrorBoundary>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        data-workspace-divider="split"
        onPointerDown={handleSplitPointerDown}
        onPointerMove={handleSplitPointerMove}
        onPointerUp={handleSplitPointerEnd}
        onPointerCancel={handleSplitPointerEnd}
        className="w-1 flex-shrink-0 cursor-col-resize touch-none bg-border/60 transition-colors hover:bg-primary active:bg-primary"
      />

      <div className="min-h-0 min-w-[280px] flex-1 overflow-hidden" data-workspace-pane="worker">
        {/* The row's close lives at its top-right corner (the worker header's
            trailing slot), not in the planner header (ui8 phase 5). */}
        <WorkerPane
          selectedProject={project}
          ws={ws}
          sendMessage={sendMessage}
          isActive
          onInputFocusChange={onInputFocusChange}
          onSessionProcessing={onSessionProcessing}
          onSessionIdle={onSessionIdle}
          processingSessions={processingSessions}
          onShowSettings={onShowSettings}
          onClose={onCloseRow}
          closeLabel={`Close ${project.displayName} row`}
        />
      </div>
    </div>
  );
}
