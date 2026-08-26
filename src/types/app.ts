export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  /** Switcher grouping: 'legacy' renders below the More models divider. */
  group?: 'current' | 'legacy';
  recordId?: number;
  isCustom?: boolean;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type CustomProviderModelInput = {
  model: string;
  id: string;
};

export type ProviderModelActions = {
  create(provider: LLMProvider, input: CustomProviderModelInput): Promise<void>;
  update(
    provider: LLMProvider,
    existing: ProviderModelOption,
    input: CustomProviderModelInput,
  ): Promise<void>;
  remove(provider: LLMProvider, existing: ProviderModelOption): Promise<void>;
};

export type AppTab = 'chat' | 'worker' | 'files' | 'git';

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  /** Worker/planner tag ('direct' | 'dispatch' | 'planner' | 'external' | 'maintenance') or null. Pane labels key off it. */
  origin?: string | null;
  /** True when the session's first message was an auto-sent boot prompt. Boot-prologue hiding keys off it. */
  booted?: boolean;
  /** Persisted boot lifecycle: null | 'pending' | 'ready' | 'failed'. 'failed' reopens as a failed boot, not a plain chat. */
  bootState?: string | null;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}


// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
/**
 * Pseudo projectId for standalone chats (hosted in the hidden scratch repo).
 * Never a real DB project id; used to suppress project-bound behaviors like
 * the New Session planner auto-boot.
 */
export const STANDALONE_PROJECT_ID = '__standalone__';

export interface Project {
  projectId: string;
  displayName: string;
  /** Stored planner identity; null/absent = sessions use the path basename. */
  plannerMemoryName?: string | null;
  /** Project icon as a data URL (repo-root convention or bundled SpotOn icon); null = client default icon. */
  iconDataUrl?: string | null;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  [key: string]: unknown;
}

export interface LoadingProgress {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}
