import { Compass, FolderTree, GitBranch, Hammer, MessageSquare, Terminal, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import WorkerPane from '../../worker-pane/WorkerPane';
import FileTree from '../../file-tree/view/FileTree';
import GitPanel from '../../git-panel/view/GitPanel';
import type { MainContentProps } from '../types/types';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import { STANDALONE_PROJECT_ID } from '../../../types/app';
import { Badge, Button, Tooltip } from '../../../shared/view/ui';
import { ActionSwapIcon } from '../../../shared/view/beui';
import { cn } from '../../../lib/utils';
import PaneStrip, { type StripPane } from '../../app/workspace/PaneStrip';
import PaneShell from '../../app/workspace/PaneShell';
import WindowPane from '../../app/workspace/WindowPane';
import WindowSelector, { type WindowSelectorItem } from '../../app/workspace/WindowSelector';
import { WINDOW_LABELS, WINDOW_ORDER, useProjectWindows } from '../../app/workspace/useProjectWindows';
import { PANE_HEADER_CLASS } from '../../app/workspace/paneHeader';

import MainContentStateView from './subcomponents/MainContentStateView';
import MobileMenuButton from './subcomponents/MobileMenuButton';
import ErrorBoundary from './ErrorBoundary';

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onSessionViewed,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onNewProjectSession,
  onProjectSelect,
  onProjectsRefresh,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  // Standalone chats have no repo of their own to work; no worker surface.
  const workerPaneAvailable = Boolean(
    selectedProject && selectedProject.projectId !== STANDALONE_PROJECT_ID,
  );
  // The windowing layer (ui13 job 10): the desktop surface is this project's
  // pane strip — planner, worker, files, source control tiled in the grid,
  // each open, railed, or closed per the project's persisted window set.
  const windows = useProjectWindows(selectedProject?.projectId ?? null);
  const desktopStrip = !isMobile && workerPaneAvailable;
  // Mobile chat/shell toggle (ui13 job 9): the planner pane's top bar swaps
  // the transcript for a terminal bound to the pane's own session. Not
  // persisted — a fresh open always lands on chat.
  const [plannerShellOpen, setPlannerShellOpen] = useState(false);
  // The Planner header mirrors the worker pane's header bar; the title is the
  // open session's stored name.
  const sessionTitle = (selectedSession?.summary || selectedSession?.title || '').trim();
  // The left pane hosts Willem's planner chats, but the sidebar and deep links
  // can put any session here; the label follows the open session's real
  // origin, so a worker-origin session never renders under a Planner label.
  const leftPaneIsWorkerSession =
    selectedSession?.origin === 'direct'
    || selectedSession?.origin === 'dispatch'
    || selectedSession?.origin === 'external'
    || selectedSession?.origin === 'maintenance';

  // Fail-safes for the pane header: the socket dropping, or the rendered
  // transcript diverging from the session the header claims.
  const { isConnected } = useWebSocket();
  const [renderedSessionId, setRenderedSessionId] = useState<string | null>(null);
  const [streamMismatch, setStreamMismatch] = useState(false);
  const claimedSessionId = selectedSession?.id ?? null;
  useEffect(() => {
    // A just-created session renders before the URL-derived selection catches
    // up, so only a mismatch that persists counts as broken wiring.
    if (!renderedSessionId || !claimedSessionId || renderedSessionId === claimedSessionId) {
      setStreamMismatch(false);
      return;
    }
    const timer = setTimeout(() => setStreamMismatch(true), 2000);
    return () => clearTimeout(timer);
  }, [renderedSessionId, claimedSessionId]);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  useEffect(() => {
    if (!workerPaneAvailable && activeTab === 'worker') {
      setActiveTab('chat');
    }
  }, [workerPaneAvailable, activeTab, setActiveTab]);

  // Desktop is chat-only (phase 2 chrome strip): the view-mode bar is gone, and
  // any other route into a non-chat tab (palette, notifications) snaps back —
  // files and source control are windows in the pane strip, not tabs (job 10).
  useEffect(() => {
    if (!isMobile && activeTab !== 'chat') {
      setActiveTab('chat');
    }
  }, [isMobile, activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      // Desktop opens the Files window in the strip; mobile its full-pane view.
      if (desktopStrip) {
        windows.setWindowState('files', 'open');
      } else {
        setActiveTab('files');
      }
      handleFileOpen(filePath);
    },
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  const plannerChat = (
    <ErrorBoundary showDetails>
      <ChatInterface
        isActive={activeTab === 'chat'}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        ws={ws}
        sendMessage={sendMessage}
        onFileOpen={handleFileOpen}
        onInputFocusChange={onInputFocusChange}
        onSessionProcessing={onSessionProcessing}
        onSessionIdle={onSessionIdle}
        processingSessions={processingSessions}
        onNavigateToSession={onNavigateToSession}
        onSessionEstablished={onSessionEstablished}
        onShowSettings={onShowSettings}
        showRawParameters={showRawParameters}
        showThinking={showThinking}
        sendByCtrlEnter={sendByCtrlEnter}
        externalMessageUpdate={externalMessageUpdate}
        newSessionTrigger={newSessionTrigger}
        onStartNewSession={selectedProject ? () => onNewProjectSession(selectedProject) : undefined}
        sessionOrigin={workerPaneAvailable ? 'planner' : null}
        onRenderedSessionChange={(renderedId) => {
          setRenderedSessionId(renderedId);
          if (renderedId && activeTab === 'chat') onSessionViewed(renderedId);
        }}
        holdQueuedFlush={isMobile && plannerShellOpen}
      />
    </ErrorBoundary>
  );

  const failSafeBadges = (
    <>
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
    </>
  );

  if (desktopStrip) {
    // The window selector (ui13 job 10): open windows carry the check; a
    // selected open window closes — planner/worker to their rails, files and
    // source control away entirely.
    const selectorItems: WindowSelectorItem[] = WINDOW_ORDER.map((id) => ({
      id,
      open: windows.states[id] === 'open',
      onSelect: () => {
        if (windows.states[id] === 'open') {
          windows.setWindowState(id, id === 'planner' || id === 'worker' ? 'rail' : 'closed');
        } else {
          windows.setWindowState(id, 'open');
        }
      },
    }));

    const stripPanes: StripPane[] = [];
    const pushPane = (id: (typeof WINDOW_ORDER)[number], minWidth: number, content: React.ReactNode) => {
      const state = windows.states[id];
      if (state === 'closed') {
        return;
      }
      stripPanes.push({
        id,
        state,
        railLabel: WINDOW_LABELS[id],
        weight: windows.weights[id],
        minWidth,
        onExpand: () => windows.setWindowState(id, 'open'),
        content: state === 'open' ? content : null,
      });
    };

    pushPane('planner', 200, (
      <>
        <div className={PANE_HEADER_CLASS} data-slot="pane-header">
          {leftPaneIsWorkerSession ? (
            <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <Compass className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground">
            {leftPaneIsWorkerSession ? 'Worker' : 'Planner'}
          </span>
          {sessionTitle && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{sessionTitle}</span>
          )}
          {failSafeBadges}
          <span className="min-w-0 flex-1" />
          <WindowSelector items={selectorItems} />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => windows.setWindowState('planner', 'rail')}
            aria-label="Hide planner pane"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1">{plannerChat}</div>
      </>
    ));

    pushPane('worker', 280, (
      <WorkerPane
        selectedProject={selectedProject}
        ws={ws}
        sendMessage={sendMessage}
        isActive
        onFileOpen={resolvedFileOpen}
        onInputFocusChange={onInputFocusChange}
        onSessionProcessing={onSessionProcessing}
        onSessionIdle={onSessionIdle}
        processingSessions={processingSessions}
        onSessionViewed={onSessionViewed}
        onShowSettings={onShowSettings}
        onClose={() => windows.setWindowState('worker', 'rail')}
      />
    ));

    pushPane('files', 220, (
      <WindowPane
        id="files"
        label={WINDOW_LABELS.files}
        icon={FolderTree}
        onRail={() => windows.setWindowState('files', 'rail')}
      >
        <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
      </WindowPane>
    ));

    pushPane('git', 220, (
      <WindowPane
        id="git"
        label={WINDOW_LABELS.git}
        icon={GitBranch}
        onRail={() => windows.setWindowState('git', 'rail')}
      >
        <GitPanel
          selectedProject={selectedProject}
          isMobile={false}
          onFileOpen={handleFileOpen}
          onProjectSelect={onProjectSelect}
          onProjectsRefresh={onProjectsRefresh}
        />
      </WindowPane>
    ));

    return (
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className={cn('flex min-h-0 min-w-0 flex-1', editorExpanded && 'hidden')}>
            <PaneStrip panes={stripPanes} onPairWeights={windows.setPairWeights} />
          </div>
          <EditorSidebar
            editingFile={editingFile}
            isMobile={isMobile}
            editorExpanded={editorExpanded}
            editorWidth={editorWidth}
            hasManualWidth={hasManualWidth}
            resizeHandleRef={resizeHandleRef}
            onResizeStart={handleResizeStart}
            onCloseEditor={handleCloseEditor}
            onToggleEditorExpand={handleToggleEditorExpand}
            projectPath={selectedProject.path}
            fillSpace={false}
          />
        </div>
      </div>
    );
  }

  // Mobile (and the project-less standalone chat): full-pane views, one
  // switcher (ui14 job 11) — the pane header's window selector is the only
  // way between Planner, Worker, Files, and Source Control; the old top strip
  // is gone. The standalone chat has no windows, so no selector.
  const mobileSelectorItems: WindowSelectorItem[] = [
    { id: 'planner' as const, tab: 'chat' as const },
    { id: 'worker' as const, tab: 'worker' as const },
    { id: 'files' as const, tab: 'files' as const },
    { id: 'git' as const, tab: 'git' as const },
  ].map(({ id, tab }) => ({
    id,
    open: activeTab === tab,
    onSelect: () => setActiveTab(tab),
  }));
  const mobileSelector = workerPaneAvailable ? <WindowSelector items={mobileSelectorItems} /> : null;
  const mobileMenu = isMobile ? <MobileMenuButton onMenuClick={onMenuClick} /> : null;
  // The pane's session is mid-turn: the shell shows the transcript read-only
  // until the SDK run releases the session file (see PaneShell).
  const plannerBusy = Boolean(selectedSession && processingSessions.has(String(selectedSession.id)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}
        >
          <div className={`h-full ${activeTab === 'chat' ? 'flex flex-col' : 'hidden'}`}>
            {(workerPaneAvailable || isMobile) && (
              <div className={PANE_HEADER_CLASS} data-slot="pane-header">
                {mobileMenu}
                {leftPaneIsWorkerSession ? (
                  <Hammer className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <Compass className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="text-xs font-medium text-foreground">
                  {leftPaneIsWorkerSession ? 'Worker' : 'Planner'}
                </span>
                {sessionTitle && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">{sessionTitle}</span>
                )}
                {failSafeBadges}
                <span className="min-w-0 flex-1" />
                {mobileSelector}
                {workerPaneAvailable && (
                  <Tooltip content={plannerShellOpen ? 'Show chat' : 'Show shell'} position="bottom">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setPlannerShellOpen((open) => !open)}
                      aria-label={plannerShellOpen ? 'Show chat' : 'Show shell'}
                      data-slot="pane-view-toggle"
                    >
                      <ActionSwapIcon value={plannerShellOpen ? 'chat' : 'shell'}>
                        {plannerShellOpen
                          ? <MessageSquare className="h-3.5 w-3.5" />
                          : <Terminal className="h-3.5 w-3.5" />}
                      </ActionSwapIcon>
                    </Button>
                  </Tooltip>
                )}
              </div>
            )}
            <PaneShell
              project={selectedProject}
              session={selectedSession}
              open={isMobile && plannerShellOpen}
              busy={plannerBusy}
            >
              {plannerChat}
            </PaneShell>
          </div>

          {isMobile && workerPaneAvailable && (
            <div className={`h-full overflow-hidden ${activeTab === 'worker' ? 'block' : 'hidden'}`}>
              <WorkerPane
                selectedProject={selectedProject}
                ws={ws}
                sendMessage={sendMessage}
                isActive={activeTab === 'worker'}
                onFileOpen={resolvedFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionProcessing={onSessionProcessing}
                onSessionIdle={onSessionIdle}
                processingSessions={processingSessions}
                onSessionViewed={onSessionViewed}
                onShowSettings={onShowSettings}
                onMenuClick={onMenuClick}
                windowSelector={mobileSelector}
              />
            </div>
          )}

          {activeTab === 'files' && (
            <WindowPane
              id="files"
              label={WINDOW_LABELS.files}
              icon={FolderTree}
              leading={mobileMenu}
              trailing={mobileSelector}
            >
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            </WindowPane>
          )}

          {activeTab === 'git' && (
            <WindowPane
              id="git"
              label={WINDOW_LABELS.git}
              icon={GitBranch}
              leading={mobileMenu}
              trailing={mobileSelector}
            >
              <GitPanel
                selectedProject={selectedProject}
                isMobile={isMobile}
                onFileOpen={handleFileOpen}
                onProjectSelect={onProjectSelect}
                onProjectsRefresh={onProjectsRefresh}
              />
            </WindowPane>
          )}

        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={activeTab === 'files'}
        />
      </div>
    </div>
  );
}

export default React.memo(MainContent);
