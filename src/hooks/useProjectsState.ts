import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { api } from '../utils/api';
import type { ServerEvent } from '../contexts/WebSocketContext';
import type {
  AppTab,
  LLMProvider,
  LoadingProgress,
  Project,
  ProjectSession,
} from '../types/app';
import { STANDALONE_PROJECT_ID } from '../types/app';
import { writeSetting } from '../utils/cloudSettings';
import { findLatestPlannerSession } from '../utils/plannerSessions';
import type { ResponseIndicatorInfo, RunningRunInfo } from '../components/sidebar/types/types';

import type { SessionActivityMap } from './useSessionProtection';

type UseProjectsStateArgs = {
  sessionId?: string;
  /** Route-pinned project id (`/project/:projectId`) that scopes this tab to one project. */
  scopedProjectId?: string;
  /** True on the /standalone route: a chat with no project, hosted in scratch. */
  standaloneMode?: boolean;
  navigate: NavigateFunction;
  /** Subscription to the unified websocket event stream. */
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  activeSessions: SessionActivityMap;
  runningRuns: RunningRunInfo[];
};

/**
 * Shape of the per-session sidebar delta broadcast by the backend file
 * watcher (`kind: session_upserted`). It carries everything needed to upsert
 * one session row in place — no full project-list snapshot is ever pushed.
 */
type SessionUpsertedEvent = ServerEvent & {
  sessionId: string;
  providerSessionId?: string | null;
  provider: LLMProvider;
  session: ProjectSession;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
  } | null;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

type RegisterOptimisticSessionArgs = {
  sessionId: string;
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
  origin?: 'direct' | 'planner' | null;
};

/**
 * Shape of `GET /api/providers/sessions/:sessionId` — the authoritative
 * session → owning-project resolution used when a `/session/<id>` URL points
 * at a session that is not present in the paginated project payloads.
 */
type SessionDetailsApiPayload = {
  data?: {
    sessionId?: string;
    provider?: string;
    summary?: string;
    origin?: string | null;
    booted?: boolean;
    createdAt?: string | null;
    lastActivity?: string | null;
    project?: {
      projectId?: string;
      path?: string;
      fullPath?: string;
      displayName?: string;
      isStarred?: boolean;
    } | null;
  };
};

type ProjectSessionPage = Pick<Project, 'sessions' | 'sessionMeta'>;

const DEFAULT_PROVIDER: LLMProvider = 'claude';

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const readSelectedProvider = (): LLMProvider => {
  try {
    const storedProvider = localStorage.getItem('selected-provider');
    return storedProvider ? storedProvider as LLMProvider : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
};

const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : DEFAULT_PROVIDER;
};

const normalizeSessionProvider = (session: ProjectSession): ProjectSession => ({
  ...session,
  __provider: getSessionProvider(session),
});

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    return (
      nextProject.projectId !== prevProject.projectId ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      Boolean(nextProject.isStarred) !== Boolean(prevProject.isStarred) ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return project.sessions ?? [];
};

const countLoadedProjectSessions = (project: Project): number => getProjectSessions(project).length;

const mergeSessionProviderLists = (baseSessions: ProjectSession[], additionalSessions: ProjectSession[]): ProjectSession[] => {
  const merged = [...baseSessions];
  const seenSessionIds = new Set(baseSessions.map((session) => String(session.id)));

  for (const session of additionalSessions) {
    const sessionId = String(session.id);
    if (seenSessionIds.has(sessionId)) {
      continue;
    }

    merged.push(session);
    seenSessionIds.add(sessionId);
  }

  return merged;
};

const mergeExpandedSessionPages = (previousProjects: Project[], incomingProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return incomingProjects;
  }

  const previousByProjectId = new Map(previousProjects.map((project) => [project.projectId, project]));

  return incomingProjects.map((incomingProject) => {
    const previousProject = previousByProjectId.get(incomingProject.projectId);
    if (!previousProject) {
      return incomingProject;
    }

    const previousLoadedCount = countLoadedProjectSessions(previousProject);
    const incomingLoadedCount = countLoadedProjectSessions(incomingProject);
    if (previousLoadedCount <= incomingLoadedCount) {
      return incomingProject;
    }

    const mergedProject: Project = {
      ...incomingProject,
      sessions: mergeSessionProviderLists(incomingProject.sessions ?? [], previousProject.sessions ?? []),
    };

    const totalSessions = Number(incomingProject.sessionMeta?.total ?? previousLoadedCount);
    mergedProject.sessionMeta = {
      ...incomingProject.sessionMeta,
      total: totalSessions,
      hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
    };

    return mergedProject;
  });
};

const mergeProjectSessionPage = (
  existingProject: Project,
  sessionsPage: ProjectSessionPage,
): Project => {
  const mergedProject: Project = {
    ...existingProject,
    sessions: mergeSessionProviderLists(existingProject.sessions ?? [], sessionsPage.sessions ?? []),
  };

  const totalSessions = Number(sessionsPage.sessionMeta?.total ?? existingProject.sessionMeta?.total ?? 0);
  mergedProject.sessionMeta = {
    ...existingProject.sessionMeta,
    ...sessionsPage.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
  };

  return mergedProject;
};

const getSessionAliasIds = (event: SessionUpsertedEvent): Set<string> => {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  };

  add(event.sessionId);
  add(event.providerSessionId);
  add(event.session?.id);

  return ids;
};

/**
 * Upserts one session into a project's normalized session list.
 *
 * Existing rows are updated in place (summary/lastActivity changes from the
 * watcher); new rows are prepended since the watcher only fires for sessions
 * with fresh activity. `sessionMeta.total` grows only on insert.
 */
const upsertSessionIntoProject = (project: Project, event: SessionUpsertedEvent): Project => {
  const sessions = project.sessions ?? [];
  const aliasIds = getSessionAliasIds(event);
  const normalizedSession: ProjectSession = {
    ...event.session,
    id: event.sessionId,
    __provider: event.provider,
  };
  const existingIndex = sessions.findIndex((session) => aliasIds.has(String(session.id)));

  let nextSessions: ProjectSession[];
  let inserted = false;
  if (existingIndex >= 0) {
    let changed = false;
    nextSessions = [];

    for (const [index, session] of sessions.entries()) {
      if (index === existingIndex) {
        const updated = { ...session, ...normalizedSession };
        // Never let a later upsert that carries an empty summary blank out a
        // title we already have. Fresh sessions momentarily broadcast an empty
        // custom_name before the disk indexer fills it in, which would
        // otherwise flash the row back to the "New session" placeholder.
        if (!normalizedSession.summary?.trim() && session.summary?.trim()) {
          updated.summary = session.summary;
        }
        if (serialize(session) !== serialize(updated)) {
          changed = true;
        }
        nextSessions.push(updated);
        continue;
      }

      if (aliasIds.has(String(session.id))) {
        changed = true;
        continue;
      }

      nextSessions.push(session);
    }

    if (!changed) {
      return project;
    }
  } else {
    nextSessions = [normalizedSession, ...sessions];
    inserted = true;
  }

  const next: Project = { ...project, sessions: nextSessions };
  if (inserted) {
    const total = Number(project.sessionMeta?.total ?? 0) + 1;
    next.sessionMeta = {
      ...project.sessionMeta,
      total,
      hasMore: countLoadedProjectSessions(next) < total,
    };
  }

  return next;
};

const projectFromRegistration = (project: Project): Project => ({
  projectId: project.projectId,
  path: project.path || project.fullPath,
  fullPath: project.fullPath || project.path || '',
  displayName: project.displayName,
  isStarred: project.isStarred,
  sessions: project.sessions ?? [],
  sessionMeta: project.sessionMeta ?? { hasMore: false, total: countLoadedProjectSessions(project) },
});

const removeSessionFromProject = (project: Project, sessionIdToDelete: string): Project => {
  const sessions = project.sessions ?? [];
  const nextSessions = sessions.filter((session) => session.id !== sessionIdToDelete);
  if (nextSessions.length === sessions.length) {
    return project;
  }

  const updatedProject: Project = {
    ...project,
    sessions: nextSessions,
  };

  const totalSessions = Math.max(0, Number(project.sessionMeta?.total ?? 0) - 1);
  updatedProject.sessionMeta = {
    ...project.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(updatedProject) < totalSessions,
  };

  return updatedProject;
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'git']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab);
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  scopedProjectId,
  standaloneMode,
  navigate,
  subscribe,
  isMobile,
  activeSessions,
  runningRuns,
}: UseProjectsStateArgs) {
  // In a scoped tab every in-app navigation stays under the project prefix so
  // the tab never escapes its project.
  const basePath = scopedProjectId ? `/project/${scopedProjectId}` : '';
  const rootPath = basePath || '/';
  const [scopedProjectNotFound, setScopedProjectNotFound] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [attentionSessionIds, setAttentionSessionIds] = useState<Set<string>>(new Set());
  const [responseIndicators, setResponseIndicators] = useState<Map<string, ResponseIndicatorInfo>>(new Map());
  // Desktop is chat-only (phase 2 chrome strip): ignore a persisted non-chat
  // tab so removed views never mount, even for one frame, on load.
  const [activeTab, setActiveTab] = useState<AppTab>(() => (isMobile ? readPersistedTab() : 'chat'));
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    try {
      writeSetting('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('system');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  /**
   * `newSessionTrigger` is an explicit, monotonic intent signal for user-driven
   * New Session actions.
   *
   * It exists because `handleNewSession` can be invoked while the app is already in
   * the same visible state (`selectedSession === null`, `activeTab === 'chat'`,
   * route already `/`). In that case, React/router updates are idempotent and no
   * downstream reset logic runs.
   *
   * Usage across the codebase:
   * 1) Produced here in `handleNewSession` via increment (always changes).
   * 2) Returned from this hook and threaded through:
   *    useProjectsState -> AppContent -> MainContent -> ChatInterface.
   * 3) Consumed in `useChatSessionState` as an effect dependency to forcibly clear
   *    chat-local state (`currentSessionId`, pending draft message, streaming flags,
   *    pending session storage keys, pagination/scroll artifacts).
   *
   * Keeping this signal dedicated avoids coupling resets to unrelated counters/events
   * (for example websocket/project refresh updates) that could cause accidental resets.
   */
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Ref mirrors for state the websocket subscription handler needs.
   *
   * The subscription is registered once (per `subscribe` identity) and events
   * are dispatched synchronously outside React's render cycle, so the handler
   * must read the latest values through refs instead of stale closures —
   * re-subscribing on every state change would risk missing events.
   */
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  // Live-run rows disappear after completion, so retain their last known
  // identity long enough to classify the unseen response that replaces them.
  const runIdentityRef = useRef(new Map<string, Pick<RunningRunInfo, 'origin' | 'projectId'>>());
  for (const run of runningRuns) {
    runIdentityRef.current.set(run.sessionId, { origin: run.origin, projectId: run.projectId });
  }
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /**
   * Sessions Willem has opened during this run. It is deliberately in memory
   * only: a cold reload starts with no view records, so no historical chat can
   * wear an unseen-response bell (ui17 job 15).
   */
  const viewedSessionsRef = useRef(new Set<string>());
  /** URL session id whose backend lookup already ran (or is in flight) — one attempt per id. */
  const sessionLookupRef = useRef<string | null>(null);

  useEffect(() => {
    sessionLookupRef.current = null;
  }, [sessionId]);

  const markResponseIndicator = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    // ui17 job 15: a bell only ever belongs to a session Willem has opened in
    // this run. Without this gate a chat he read long ago earns one for free:
    // the sessions watcher (`sessions-watcher.service.ts`) folds any transcript
    // file write into the running-sessions poll for a 15s TTL, and when that
    // TTL lapses the id leaves `activeSessions`, which the completion-edge
    // effect below cannot tell apart from a finished turn. No view record
    // counts as seen, so history stays quiet.
    if (!viewedSessionsRef.current.has(targetSessionId)) {
      return;
    }

    const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;
    const visibleHere = targetSessionId === viewedSessionId
      && activeTabRef.current === 'chat'
      && (typeof document === 'undefined' || document.visibilityState === 'visible');
    if (visibleHere) {
      return;
    }

    const cachedRun = runIdentityRef.current.get(targetSessionId);
    let origin: string | null = cachedRun?.origin ?? null;
    let projectId = cachedRun?.projectId ?? null;
    if (!cachedRun) {
      for (const project of projectsRef.current) {
        const session = project.sessions?.find((candidate) => String(candidate.id) === targetSessionId);
        if (!session) continue;
        origin = session.origin ?? null;
        projectId = project.projectId;
        break;
      }
    }
    const kind: ResponseIndicatorInfo['kind'] = origin === null || origin === 'planner' ? 'planner' : 'worker';

    setResponseIndicators((previous) => {
      if (previous.has(targetSessionId)) {
        return previous;
      }

      const next = new Map(previous);
      next.set(targetSessionId, { kind, projectId });
      return next;
    });
  }, [sessionId]);

  const clearResponseIndicator = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    setResponseIndicators((previous) => {
      if (!previous.has(targetSessionId)) {
        return previous;
      }

      const next = new Map(previous);
      next.delete(targetSessionId);
      return next;
    });
  }, []);

  const markSessionAttention = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return;
    const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;
    if (targetSessionId === viewedSessionId) return;
    setAttentionSessionIds((previous) => {
      if (previous.has(targetSessionId)) return previous;
      const next = new Set(previous);
      next.add(targetSessionId);
      return next;
    });
  }, [sessionId]);

  const clearSessionIndicators = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) return;
    // Opening a session is the view record the bell is measured against.
    viewedSessionsRef.current.add(targetSessionId);
    clearResponseIndicator(targetSessionId);
    setAttentionSessionIds((previous) => {
      if (!previous.has(targetSessionId)) return previous;
      const next = new Set(previous);
      next.delete(targetSessionId);
      return next;
    });
  }, [clearResponseIndicator]);

  // Poll-driven and websocket-driven runs share the same completion edge.
  // Watching the activity map covers dispatch/direct sessions whose runtime
  // does not stream into the currently open chat socket.
  const previousActiveSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(activeSessions.keys());
    for (const previousId of previousActiveSessionIdsRef.current) {
      if (!current.has(previousId)) markResponseIndicator(previousId);
    }
    previousActiveSessionIdsRef.current = current;
  }, [activeSessions, markResponseIndicator]);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        const mergedProjects = mergeExpandedSessionPages(prevProjects, projectData);

        if (prevProjects.length === 0) {
          return mergedProjects;
        }

        return projectsHaveChanges(prevProjects, mergedProjects)
          ? mergedProjects
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  const registerOptimisticSession = useCallback(({
    sessionId: newSessionId,
    provider,
    project,
    summary,
    origin,
  }: RegisterOptimisticSessionArgs) => {
    if (!newSessionId || !project?.projectId) {
      return;
    }

    const now = new Date().toISOString();
    const optimisticSession: ProjectSession = {
      id: newSessionId,
      summary: summary ?? '',
      origin: origin ?? null,
      messageCount: 0,
      createdAt: now,
      created_at: now,
      updated_at: now,
      lastActivity: now,
      __provider: provider,
      __projectId: project.projectId,
    };
    const upsert: SessionUpsertedEvent = {
      kind: 'session_upserted',
      sessionId: newSessionId,
      provider,
      session: optimisticSession,
      project: {
        projectId: project.projectId,
        path: project.path || project.fullPath,
        fullPath: project.fullPath || project.path || '',
        displayName: project.displayName,
        isStarred: Boolean(project.isStarred),
      },
      timestamp: now,
    };

    setProjects((previousProjects) => {
      const existingProject = previousProjects.find((candidate) => candidate.projectId === project.projectId);
      if (!existingProject) {
        return [upsertSessionIntoProject(projectFromRegistration(project), upsert), ...previousProjects];
      }

      const updatedProject = upsertSessionIntoProject(existingProject, upsert);
      if (updatedProject === existingProject) {
        return previousProjects;
      }

      return previousProjects.map((candidate) =>
        candidate.projectId === existingProject.projectId ? updatedProject : candidate,
      );
    });

    setSelectedProject((previousProject) => {
      if (!previousProject || previousProject.projectId !== project.projectId) {
        return previousProject;
      }

      const updatedProject = upsertSessionIntoProject(previousProject, upsert);
      return updatedProject === previousProject ? previousProject : updatedProject;
    });

    setSelectedSession((previousSession) => (
      previousSession?.id === newSessionId
        ? { ...previousSession, ...optimisticSession }
        : optimisticSession
    ));
  }, []);

  const openSettings = useCallback((tab = 'system') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
    // Settings fills the sidebar (ui13 job 5): on mobile the sidebar overlay
    // must be open for the surface to be visible.
    if (isMobile) {
      setSidebarOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  // Scoped-tab resolver, mirroring the sessionId resolver below: when the URL
  // pins a project, lock the selection to it so new sessions are created with
  // that project's path. An id that is still missing after the project list
  // has loaded flips `scopedProjectNotFound` instead of falling back to the
  // global view. With a sessionId in the URL, selection is left to the
  // sessionId resolver.
  useEffect(() => {
    if (!scopedProjectId) {
      setScopedProjectNotFound(false);
      return;
    }

    const scopedProject = projects.find((project) => project.projectId === scopedProjectId);
    if (!scopedProject) {
      setScopedProjectNotFound(!isLoadingProjects);
      return;
    }

    setScopedProjectNotFound(false);
    if (!sessionId && selectedProject?.projectId !== scopedProject.projectId) {
      setSelectedProject(scopedProject);
    }
  }, [isLoadingProjects, projects, scopedProjectId, selectedProject?.projectId, sessionId]);

  // Desktop has no global all-projects view (phase 3): loading the bare root
  // lands on the selected project, else the most recently active one, through
  // the unchanged /project/:projectId route. Mobile keeps the global list.
  useEffect(() => {
    if (isMobile || scopedProjectId || standaloneMode || sessionId || isLoadingProjects || projects.length === 0) {
      return;
    }

    const latestActivity = (project: Project): number =>
      (project.sessions ?? []).reduce((latest, session) => {
        const stamp = Date.parse(
          String(session.lastActivity ?? session.updated_at ?? session.created_at ?? ''),
        );
        return Number.isFinite(stamp) && stamp > latest ? stamp : latest;
      }, 0);

    const targetProjectId =
      selectedProject?.projectId
      ?? [...projects].sort((a, b) => latestActivity(b) - latestActivity(a))[0].projectId;

    navigate(`/project/${targetProjectId}`, { replace: true });
  }, [isLoadingProjects, isMobile, navigate, projects, scopedProjectId, standaloneMode, selectedProject?.projectId, sessionId]);

  // /standalone: select the scratch-backed pseudo project so the composer has
  // a working directory while the chat presents as project-less. The trigger
  // bump resets the chat surface like any New Session (the planner auto-boot
  // is suppressed for the standalone pseudo project).
  useEffect(() => {
    if (!standaloneMode || sessionId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await api.scratchProject();
        if (!response.ok) {
          throw new Error(`scratch-project lookup failed (${response.status})`);
        }
        const body = (await response.json()) as { data?: { path?: string } };
        const scratchPath = body.data?.path;
        if (cancelled || !scratchPath) {
          return;
        }
        setSelectedProject({
          projectId: STANDALONE_PROJECT_ID,
          displayName: 'No project',
          fullPath: scratchPath,
          path: scratchPath,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 },
        });
        setSelectedSession(null);
        setActiveTab('chat');
        setNewSessionTrigger((previous) => previous + 1);
      } catch (error) {
        console.error('Could not initialize a standalone chat:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [standaloneMode, sessionId]);

  // Realtime sidebar updates. The backend pushes per-session deltas
  // (`session_upserted`) instead of full project snapshots, so each event is
  // a keyed upsert that can never clobber unrelated client state — no
  // "suppress updates while a run is active" protection is needed anymore.
  useEffect(() => {
    const handleEvent = (event: ServerEvent) => {
      if (event.kind === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }

        setLoadingProgress(event as unknown as LoadingProgress);

        if (event.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }

        return;
      }

      const eventSessionId = typeof event.sessionId === 'string' && event.sessionId
        ? event.sessionId
        : null;

      if (event.kind === 'complete' && event.aborted !== true) {
        markResponseIndicator(eventSessionId);
      }
      if (
        eventSessionId
        && event.kind !== 'chat_subscribed'
        && event.kind !== 'loading_progress'
        && event.kind !== 'session_upserted'
        && event.kind !== 'status'
        && event.kind !== 'stream_end'
        && event.kind !== 'permission_cancelled'
        && event.kind !== 'websocket_reconnected'
      ) {
        markSessionAttention(eventSessionId);
      }

      if (event.kind !== 'session_upserted') {
        return;
      }

      const upsert = event as SessionUpsertedEvent;
      if (!upsert.sessionId || !upsert.session) {
        return;
      }

      // The transcript of the currently viewed session changed on disk while
      // no run is active here (e.g. edited from another client or the CLI):
      // signal the chat view to reload its messages.
      const currentSelectedSession = selectedSessionRef.current;
      if (
        currentSelectedSession
        && upsert.sessionId === currentSelectedSession.id
        && !activeSessionsRef.current.has(upsert.sessionId)
      ) {
        setExternalMessageUpdate((prev) => prev + 1);
      } else {
        markSessionAttention(upsert.sessionId);
      }

      // Chat lists hold exactly what the server queries allow: origin NULL or
      // 'planner'. Machine-started runs ('direct', 'dispatch', 'external' —
      // or any origin this build doesn't know) live in the worker pane's run
      // switcher, never in project chat lists. A delta for one must not
      // insert it — and if the session was visible before being tagged, the
      // delta removes it from any list holding it.
      const upsertOrigin = upsert.session.origin ?? null;
      if (upsertOrigin !== null && upsertOrigin !== 'planner') {
        setProjects((previousProjects) => {
          let changed = false;
          const nextProjects = previousProjects.map((project) => {
            const sessions = getProjectSessions(project);
            const filtered = sessions.filter((session) => session.id !== upsert.sessionId);
            if (filtered.length === sessions.length) {
              return project;
            }
            changed = true;
            return {
              ...project,
              sessions: filtered,
              sessionMeta: {
                ...project.sessionMeta,
                total: Math.max(0, Number(project.sessionMeta?.total ?? sessions.length) - 1),
              },
            };
          });
          return changed ? nextProjects : previousProjects;
        });
        return;
      }

      setProjects((previousProjects) => {
        const targetProjectId = upsert.project?.projectId;
        const existingProject = previousProjects.find((project) =>
          targetProjectId ? project.projectId === targetProjectId : getProjectSessions(project).some((session) => session.id === upsert.sessionId),
        );

        if (!existingProject) {
          // First session of a project this client has never seen: create the
          // project entry from the event payload.
          if (!upsert.project) {
            return previousProjects;
          }

          const newProject: Project = {
            projectId: upsert.project.projectId,
            path: upsert.project.path,
            fullPath: upsert.project.fullPath,
            displayName: upsert.project.displayName,
            isStarred: upsert.project.isStarred,
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          } as Project;

          return [...previousProjects, upsertSessionIntoProject(newProject, upsert)];
        }

        const updatedProject = upsertSessionIntoProject(existingProject, upsert);
        if (updatedProject === existingProject) {
          return previousProjects;
        }

        return previousProjects.map((project) =>
          project.projectId === existingProject.projectId ? updatedProject : project,
        );
      });

      // Keep the selected project reference in sync with the upsert.
      setSelectedProject((previousProject) => {
        if (!previousProject) {
          return previousProject;
        }
        const matches = upsert.project
          ? previousProject.projectId === upsert.project.projectId
          : getProjectSessions(previousProject).some((session) => session.id === upsert.sessionId);
        if (!matches) {
          return previousProject;
        }
        const updated = upsertSessionIntoProject(previousProject, upsert);
        return updated === previousProject ? previousProject : updated;
      });

      const aliasedSelectedSessionId =
        typeof upsert.providerSessionId === 'string' && upsert.providerSessionId !== upsert.sessionId
          ? upsert.providerSessionId
          : null;
      if (!aliasedSelectedSessionId) {
        return;
      }

      const normalizedSelectedSession: ProjectSession = {
        ...upsert.session,
        id: upsert.sessionId,
        __provider: upsert.provider,
        __projectId: upsert.project?.projectId ?? currentSelectedSession?.__projectId,
      };

      setSelectedSession((previousSession) => {
        if (previousSession?.id !== aliasedSelectedSessionId) {
          return previousSession;
        }

        return {
          ...previousSession,
          ...normalizedSelectedSession,
        };
      });

      if (sessionId === aliasedSelectedSessionId) {
        navigate(`${basePath}/session/${upsert.sessionId}`);
      }
    };

    return subscribe(handleEvent);
  }, [basePath, markResponseIndicator, markSessionAttention, navigate, sessionId, subscribe]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    clearSessionIndicators(selectedSession?.id ?? sessionId ?? null);
  }, [clearSessionIndicators, selectedSession?.id, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    // Project membership is resolved through `projectId` after the migration.
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === sessionId);
      if (match) {
        const normalizedSession = normalizeSessionProvider(match);
        const shouldUpdateProject = selectedProject?.projectId !== project.projectId;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== normalizedSession.__provider;

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession(normalizedSession);
        }
        return;
      }
    }

    // A row click can set the session before its owning project is known
    // (Chats-feed rows for projects outside the loaded list, e.g. the scratch
    // project): with no selected project the chat surface cannot render, so
    // fall through to the backend lookup instead of stopping here.
    if (selectedSession?.id === sessionId && selectedProject) {
      return;
    }

    // Session id is in the URL but not present on any loaded project payload.
    // The payloads are paginated (only each project's first session page is
    // loaded), so this is normal for deep links to older sessions. Never guess
    // the owning project from local state — that used to bind the session to
    // whatever project happened to be selected. Ask the backend instead; one
    // lookup per URL id.
    if (sessionLookupRef.current === sessionId) {
      return;
    }
    sessionLookupRef.current = sessionId;

    void (async () => {
      let details: SessionDetailsApiPayload['data'] | null = null;
      try {
        const response = await api.sessionDetails(sessionId);
        if (response.ok) {
          const payload = (await response.json()) as SessionDetailsApiPayload;
          details = payload.data ?? null;
        }
      } catch (error) {
        console.error(`Error resolving session ${sessionId}:`, error);
      }

      // The user navigated elsewhere while the lookup was in flight.
      if (sessionIdRef.current !== sessionId) {
        return;
      }

      if (!details) {
        // Unknown session id (or lookup failed). Fall back to the legacy
        // behavior: host a placeholder under the currently selected project so
        // chat state stays alive (without a `selectedSession`, chat clears
        // `currentSessionId` and stops reading the session store).
        const fallbackProject = selectedProjectRef.current;
        if (!fallbackProject || selectedSessionRef.current?.id === sessionId) {
          return;
        }

        setSelectedSession({
          id: sessionId,
          __provider: readSelectedProvider(),
          __projectId: fallbackProject.projectId,
          summary: '',
        });
        return;
      }

      // The URL carried a provider-native alias id: swap it for the canonical
      // app-facing id and let this effect re-run against the new URL.
      if (typeof details.sessionId === 'string' && details.sessionId && details.sessionId !== sessionId) {
        navigate(`${basePath}/session/${details.sessionId}`, { replace: true });
        return;
      }

      const resolvedProjectId = details.project?.projectId;
      if (resolvedProjectId) {
        setSelectedProject((previousProject) => {
          if (previousProject?.projectId === resolvedProjectId) {
            return previousProject;
          }

          const loadedProject = projectsRef.current.find(
            (candidate) => candidate.projectId === resolvedProjectId,
          );
          if (loadedProject) {
            return loadedProject;
          }

          // Owning project is not in the active project list (e.g. archived):
          // synthesize a minimal entry so the chat view still gets its paths.
          return {
            projectId: resolvedProjectId,
            path: details.project?.path ?? details.project?.fullPath ?? '',
            fullPath: details.project?.fullPath ?? details.project?.path ?? '',
            displayName: details.project?.displayName ?? '',
            isStarred: Boolean(details.project?.isStarred),
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          };
        });
      }

      const resolvedSession: ProjectSession = {
        id: sessionId,
        summary: details.summary ?? '',
        origin: details.origin ?? null,
        booted: Boolean(details.booted),
        createdAt: details.createdAt ?? undefined,
        lastActivity: details.lastActivity ?? undefined,
        __provider:
          typeof details.provider === 'string' && details.provider.trim()
            ? (details.provider as LLMProvider)
            : readSelectedProvider(),
        __projectId: resolvedProjectId,
      };

      setSelectedSession((previousSession) =>
        previousSession?.id === sessionId
          ? { ...previousSession, ...resolvedSession }
          : resolvedSession,
      );
    })();
  }, [basePath, navigate, sessionId, projects, selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      // Selecting a project restores its planner chat (ui13 job 15): the
      // session this project is already showing when it is re-selected, else
      // its most recent planner chat — never a blank pane that needs a second
      // click on the chat. Only a bare project route is the New Session landing.
      const current = selectedSessionRef.current;
      const session =
        selectedProjectRef.current?.projectId === project.projectId
        && current
        && (!current.__projectId || current.__projectId === project.projectId)
          ? current
          : findLatestPlannerSession(project.sessions);
      setSelectedProject(project);
      setSelectedSession(session ? normalizeSessionProvider(session) : null);

      if (isMobile) {
        setSidebarOpen(false);
      }

      // Desktop: picking a project from the Projects tab re-docks the tab to
      // that project's route (claude.ai model), instead of snapping back to
      // the previously pinned project.
      const prefix = isMobile ? basePath : `/project/${project.projectId}`;
      navigate(session ? `${prefix}/session/${session.id}` : prefix || rootPath);
    },
    [basePath, isMobile, navigate, rootPath],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      clearSessionIndicators(session.id);
      setSelectedSession(session);

      if (isMobile) {
        // The phone sidebar covers the whole screen (ui14 job 11), so opening
        // any chat closes it — same-project taps included.
        setSidebarOpen(false);
      }

      navigate(`${basePath}/session/${session.id}`);
    },
    [basePath, clearSessionIndicators, isMobile, navigate],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setNewSessionTrigger((previous) => previous + 1);
      navigate(rootPath);

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, rootPath],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      clearSessionIndicators(sessionIdToDelete);

      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate(rootPath);
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => removeSessionFromProject(project, sessionIdToDelete)),
      );
    },
    [clearSessionIndicators, navigate, rootPath, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];
      const mergedProjects = mergeExpandedSessionPages(projects, freshProjects);

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, mergedProjects) ? mergedProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = mergedProjects.find((project) => project.projectId === selectedProject.projectId);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [projects, selectedProject, selectedSession]);

  const loadMoreProjectSessions = useCallback(async (projectId: string) => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) {
      return;
    }

    const loadedCount = countLoadedProjectSessions(project);
    const totalCount = Number(project.sessionMeta?.total ?? 0);
    if (totalCount > 0 && loadedCount >= totalCount) {
      return;
    }

    const response = await api.projectSessions(projectId, {
      limit: 20,
      offset: loadedCount,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string | { message?: string } };
      const errorPayload = payload.error;
      const message =
        typeof errorPayload === 'string'
          ? errorPayload
          : errorPayload && typeof errorPayload === 'object' && errorPayload.message
            ? errorPayload.message
            : `Failed to load more sessions for project ${projectId}`;
      throw new Error(message);
    }

    const sessionsPage = (await response.json()) as ProjectSessionPage;

    let mergedProjectForSelection: Project | null = null;
    setProjects((previousProjects) =>
      previousProjects.map((candidate) => {
        if (candidate.projectId !== projectId) {
          return candidate;
        }

        const mergedProject = mergeProjectSessionPage(candidate, sessionsPage);
        mergedProjectForSelection = mergedProject;
        return mergedProject;
      }),
    );

    if (selectedProject?.projectId === projectId && mergedProjectForSelection) {
      setSelectedProject(mergedProjectForSelection);
    }
  }, [projects, selectedProject?.projectId]);

  // `projectId` is the DB identifier passed from the sidebar's delete flow
  // after the migration away from folder-derived project names.
  const handleProjectDelete = useCallback(
    (projectId: string) => {
      if (selectedProject?.projectId === projectId) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate(rootPath);
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.projectId !== projectId));
    },
    [navigate, rootPath, selectedProject?.projectId],
  );

  // Scoped tabs pin the sidebar to the one route-selected project, so there
  // is no project switcher to escape through.
  // The sidebar always sees the full project list (B1): the Projects tab and
  // the attach-to-project picker need every project even on a docked tab.
  const visibleProjects = projects;

  const sidebarSharedProps = useMemo(
    () => ({
      projects: visibleProjects,
      scopedProjectId: scopedProjectId ?? null,
      selectedProject,
      selectedSession,
      activeSessions,
      attentionSessionIds,
      responseIndicators,
      onSessionViewed: clearSessionIndicators,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onLoadMoreSessions: loadMoreProjectSessions,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      responseIndicators,
      attentionSessionIds,
      clearSessionIndicators,
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      loadMoreProjectSessions,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      activeSessions,
      scopedProjectId,
      visibleProjects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    scopedProjectNotFound,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    loadMoreProjectSessions,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
