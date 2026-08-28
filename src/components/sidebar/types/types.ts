import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

export type SidebarSearchMode = 'projects' | 'conversations' | 'archived';
export type ArchivedProjectListItem = Project & { isArchived: true };

export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

export type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

export type RecentConversationListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'sessionTitle' | 'lastActivity'
> & {
  /** Null for standalone (project-less) chats hosted in the scratch repo. */
  projectDisplayName: string | null;
  /** True when this chat is the owning project's watchdog wake target. */
  watchdogWakeTarget: boolean;
};

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

// Delete confirmation payload used by sidebar UX. `projectId`/`provider` are
// kept for wiring compatibility, while API deletion now keys only by sessionId.
export type SessionDeleteConfirmation = {
  projectId: string | null;
  sessionId: string;
  sessionTitle: string;
  provider: LLMProvider;
  isArchived: boolean;
};

/** One live run from the server's run registry, joined with origin and owning project. */
export type RunningRunInfo = {
  sessionId: string;
  provider: LLMProvider;
  origin: 'planner' | 'direct' | 'dispatch' | 'external' | 'maintenance' | null;
  projectId: string | null;
  /** Owning project's display name; null for project-less (scratch) chats. */
  projectDisplayName: string | null;
  /** Session title (custom name); null while still on a placeholder. */
  title: string | null;
  chainSlug: string | null;
  chainPhase: number | null;
  /** Manifest name of the chain unit, when the chain is known to the watchdog. */
  chainPhaseName: string | null;
};

/**
 * One row of the counter drawers (ui11 phase 12): an active session of one
 * kind, labeled and grouped for the drawer list.
 */
export type ActiveSessionRow = {
  sessionId: string;
  kind: 'planner' | 'worker';
  /** Planner rows: the session title. Worker rows: the run switcher's label. */
  label: string;
  projectId: string | null;
  /** Grouping header; null groups under the project-less bucket. */
  projectDisplayName: string | null;
  state: 'working' | 'attention' | 'idle';
  provider: LLMProvider;
};

export type ResponseIndicatorInfo = {
  kind: 'planner' | 'worker';
  projectId: string | null;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  /** Route-pinned project id when the tab is scoped (`/project/:projectId`). */
  scopedProjectId?: string | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  /** Permission and other live events waiting on Willem. */
  attentionSessionIds: ReadonlySet<string>;
  /** Completed responses that have not yet been opened, keyed by session. */
  responseIndicators: ReadonlyMap<string, ResponseIndicatorInfo>;
  /** Opening a planner or worker chat clears its completed-response mark. */
  onSessionViewed: (sessionId: string) => void;
  /** Live runs enriched with origin/project (5s poll of the run registry). */
  runningRuns: RunningRunInfo[];
  /** Projects open as multi-project workspace rows (desktop only). */
  workspaceProjectIds?: string[];
  /** Closes a project's workspace row (sidebar hover-close). */
  onCloseWorkspaceProject?: (project: Project) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
  /** Phone only: closes the full-screen sidebar. */
  onClose?: () => void;
};

export type SessionViewModel = {
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};
