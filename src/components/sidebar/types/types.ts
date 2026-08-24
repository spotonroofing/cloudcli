import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';
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
  origin: 'planner' | 'direct' | 'dispatch' | 'external' | null;
  projectId: string | null;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  /** Route-pinned project id when the tab is scoped (`/project/:projectId`). */
  scopedProjectId?: string | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
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
};

export type SessionViewModel = {
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};
