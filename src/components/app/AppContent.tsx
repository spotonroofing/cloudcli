import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import type { RunningRunInfo } from '../sidebar/types/types';
import CommandPalette from '../command-palette/CommandPalette';
import { QuickSettingsPanel } from '../quick-settings-panel';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../contexts/PaletteOpsContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useCloudSync } from '../../hooks/useCloudSync';
import { useQueuedMessageAutoSend } from '../../hooks/useQueuedMessageAutoSend';
import { writeSetting } from '../../utils/cloudSettings';
import { useAuth } from '../auth/context/AuthContext';
import { api } from '../../utils/api';
import { isNotificationSoundEnabled } from '../../utils/notificationSound';

import WorkspaceView from './workspace/WorkspaceView';
import { useWorkspace } from './workspace/useWorkspace';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
  origin?: unknown;
  projectId?: unknown;
};

const RUN_ORIGINS = ['planner', 'direct', 'dispatch', 'external', 'maintenance'] as const;
type RunOrigin = (typeof RUN_ORIGINS)[number];

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default function AppContent() {
  return (
    <PaletteOpsProvider>
      <AppContentInner />
    </PaletteOpsProvider>
  );
}

function AppContentInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId, projectId } = useParams<{ sessionId?: string; projectId?: string }>();
  // /standalone hosts project-less chats (backed by the hidden scratch repo).
  const standaloneMode = location.pathname === '/standalone';
  // Scoped tab (`/project/:projectId`): session navigation keeps the prefix so
  // the tab stays docked to its project.
  const projectBasePath = projectId ? `/project/${projectId}` : '';
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
  const { user } = useAuth();

  const {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  } = useSessionProtection();

  const [runningRuns, setRunningRuns] = useState<RunningRunInfo[]>([]);

  const {
    projects,
    scopedProjectNotFound,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleNewSession,
    handleProjectSelect,
  } = useProjectsState({
    sessionId,
    scopedProjectId: projectId,
    standaloneMode,
    navigate,
    subscribe,
    isMobile,
    activeSessions: processingSessions,
  });

  // Multi-project workspace (phase 7): which projects are open as stacked
  // rows. With a single open project the surface renders exactly as before.
  const workspace = useWorkspace({
    selectedProjectId: selectedProject?.projectId ?? null,
    projects,
  });

  // Closing the primary (URL-driven) row hands the selection to the next open
  // project so the workspace never renders without its primary.
  const handleCloseWorkspaceRow = useCallback(
    (projectId: string) => {
      workspace.closeProject(projectId);
      if (projectId !== selectedProject?.projectId) {
        return;
      }
      const nextId = workspace.order.find((id) => id !== projectId);
      const nextProject = nextId ? projects.find((project) => project.projectId === nextId) : undefined;
      if (nextProject) {
        handleProjectSelect(nextProject);
      }
    },
    [workspace, selectedProject?.projectId, projects, handleProjectSelect],
  );

  // Settings and queued messages follow the user across devices (ui11 phase 1).
  useCloudSync({ subscribe, userId: user?.id });

  // Queued messages for sessions that finish while another session (or none)
  // is being viewed are sent from here; the viewed session's composer handles
  // its own queue.
  useQueuedMessageAutoSend({
    processingSessions,
    activeSessionId: selectedSession?.id ?? sessionId ?? null,
    ws,
    sendMessage,
    markSessionProcessing,
  });

  // Foreground enhancement (spec B8): a visible tab plays the Orca
  // notification sound when a fleet notification lands. Background pushes keep
  // the system default sound; this is deliberately a foreground-only behavior.
  useEffect(() => {
    const unsubscribe = subscribe?.((event: { kind?: string } | null) => {
      if (event?.kind !== 'fleet_notification') {
        return;
      }
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return;
      }
      if (!isNotificationSoundEnabled()) {
        return;
      }
      try {
        const audio = new Audio('/sounds/orca-notification.mp3');
        void audio.play().then(() => {
          const w = window as typeof window & { __fleetSoundPlays?: number };
          w.__fleetSoundPlays = (w.__fleetSoundPlays ?? 0) + 1;
        }).catch(() => {
          // Autoplay may be blocked before first interaction; the push still lands.
        });
      } catch {
        // Audio unavailable; the push notification still lands.
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [subscribe]);

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      // Sidebar identity: planner/worker counters and project-row shimmer key
      // off each live run's origin and owning project.
      setRunningRuns(
        sessions
          .filter((session): session is RunningSessionApiItem & { sessionId: string } =>
            typeof session.sessionId === 'string' && session.sessionId.length > 0)
          .map((session) => ({
            sessionId: session.sessionId,
            origin: RUN_ORIGINS.includes(session.origin as RunOrigin) ? (session.origin as RunOrigin) : null,
            projectId: typeof session.projectId === 'string' ? session.projectId : null,
          })),
      );

      syncProcessingSessions(
        sessions
          .map((session) => {
            if (typeof session.sessionId !== 'string' || !session.sessionId) {
              return null;
            }

            return {
              sessionId: session.sessionId,
              startedAt: parseStartedAt(session.startedAt),
              statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
              canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      );
    } catch (error) {
      console.error('[AppContent] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshRunningSessions]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        writeSetting('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Pending tool permissions are recovered through the `chat.subscribe` flow:
  // the `chat_subscribed` ack carries them on session open and on reconnect,
  // so no separate permission-recovery message is needed here.

  // Adjust the app container to stay above the virtual keyboard on iOS Safari.
  // On Chrome for Android the layout viewport already shrinks when the keyboard opens,
  // so inset-0 adjusts automatically. On iOS the layout viewport stays full-height and
  // the keyboard overlays it — we use the Visual Viewport API to track keyboard height
  // and apply it as a CSS variable that shifts the container's bottom edge up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  // Scoped route with an unknown project id: show a plain not-found state
  // instead of falling back to the global project list.
  if (scopedProjectNotFound) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-1 bg-background">
        <p className="text-lg font-medium text-foreground">Project not found</p>
        <p className="text-sm text-muted-foreground">This link points to a project that does not exist on this server.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background" style={{ bottom: 'var(--keyboard-height, 0px)' }}>
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar
            {...sidebarSharedProps}
            runningRuns={runningRuns}
            workspaceProjectIds={workspace.order}
            onCloseWorkspaceProject={(project) => handleCloseWorkspaceRow(project.projectId)}
          />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/50 bg-background transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} runningRuns={runningRuns} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceView
          projects={projects}
          workspace={workspace}
          onCloseRow={handleCloseWorkspaceRow}
          onNewProjectSession={handleNewSession}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionProcessing={markSessionProcessing}
          onSessionIdle={markSessionIdle}
          processingSessions={processingSessions}
          onNavigateToSession={(targetSessionId: string, options) =>
            navigate(`${projectBasePath}/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
          }
          onSessionEstablished={(targetSessionId, context) =>
            registerOptimisticSession({ sessionId: targetSessionId, ...context })
          }
          onShowSettings={openSettings}
          externalMessageUpdate={externalMessageUpdate}
          newSessionTrigger={newSessionTrigger}
          onProjectSelect={handleProjectSelect}
          onProjectsRefresh={() => void refreshProjectsSilently()}
        />
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        projects={projects}
        onProjectSelect={handleProjectSelect}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        // Desktop is chat-only (phase 2 chrome strip): no tab navigation from the palette.
        onShowTab={isMobile ? setActiveTab : undefined}
      />

      <QuickSettingsPanel />
    </div>
  );
}
