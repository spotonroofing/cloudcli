import { Compass, FolderTree, GitBranch, Hammer, MessageSquare, Terminal, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import WorkerPane from '../../worker-pane/WorkerPane';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import PluginTabContent from '../../plugins/view/PluginTabContent';
import { BrowserUsePanel } from '../../browser-use';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { Project } from '../../../types/app';
import { STANDALONE_PROJECT_ID } from '../../../types/app';
import { TaskMasterPanel } from '../../task-master';
import { Badge, Button, Tooltip } from '../../../shared/view/ui';
import { ActionSwapIcon } from '../../../shared/view/beui';
import { cn } from '../../../lib/utils';
import PaneStrip, { type StripPane } from '../../app/workspace/PaneStrip';
import WindowPane from '../../app/workspace/WindowPane';
import WindowSelector, { type WindowSelectorItem } from '../../app/workspace/WindowSelector';
import { WINDOW_LABELS, WINDOW_ORDER, useProjectWindows } from '../../app/workspace/useProjectWindows';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
};

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
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onProjectSelect,
  onProjectsRefresh,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings() as TasksSettingsContextValue;
  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
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

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const shouldShowBrowserTab = browserUseEnabled;

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
    // Identify projects by DB `projectId`; the TaskMaster context uses the
    // same identifier to key its internal maps.
    const selectedProjectId = selectedProject?.projectId;
    const currentProjectId = currentProject?.projectId;

    if (selectedProject && selectedProjectId !== currentProjectId) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject?.projectId, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

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

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

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
        sessionOrigin={workerPaneAvailable ? 'planner' : null}
        onRenderedSessionChange={setRenderedSessionId}
        onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
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
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
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

  // Mobile (and the project-less standalone chat): full-pane views behind the
  // tab rail, windows reachable through the same selector (ui13 job 10).
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

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          shouldShowTasksTab={shouldShowTasksTab}
          shouldShowBrowserTab={shouldShowBrowserTab}
          onMenuClick={onMenuClick}
        />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}
        >
          <div className={`h-full ${activeTab === 'chat' ? 'flex flex-col' : 'hidden'}`}>
            {workerPaneAvailable && (
              <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
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
                <WindowSelector items={mobileSelectorItems} />
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
              </div>
            )}
            <div className={`min-h-0 flex-1 ${isMobile && plannerShellOpen ? 'hidden' : ''}`}>
              {plannerChat}
            </div>
            {isMobile && plannerShellOpen && (
              <div className="min-h-0 flex-1 overflow-hidden" data-slot="pane-shell">
                <StandaloneShell
                  project={selectedProject}
                  session={selectedSession}
                  showHeader={false}
                  isActive
                />
              </div>
            )}
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
                onShowSettings={onShowSettings}
              />
            </div>
          )}

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitPanel
                selectedProject={selectedProject}
                isMobile={isMobile}
                onFileOpen={handleFileOpen}
                onProjectSelect={onProjectSelect}
                onProjectsRefresh={onProjectsRefresh}
              />
            </div>
          )}

          {shouldShowTasksTab && <TaskMasterPanel isVisible={activeTab === 'tasks'} />}

          {shouldShowBrowserTab && activeTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserUsePanel isVisible={activeTab === 'browser'} />
            </div>
          )}

          {activeTab.startsWith('plugin:') && (
            <div className="h-full overflow-hidden">
              <PluginTabContent
                pluginName={activeTab.replace('plugin:', '')}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
              />
            </div>
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
