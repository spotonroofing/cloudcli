import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type {
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';

export type Provider = LLMProvider;

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';

export interface ChatAttachment {
  /** Absolute path inside the server-managed chat attachment store. */
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface ChatImage extends ChatAttachment {
  /** Inline data URL (Claude history stores image attachments as base64). */
  data?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface ChatMessage {
  /** Store message id (NormalizedMessage.id); the stable React-key source. */
  id?: string;
  type: string;
  content?: string;
  /** Explicit producer identity for a user-role turn not authored by Willem. */
  messageOrigin?: 'watchdog';
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  files?: ChatAttachment[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  /** Expanded command text (composer-sent commands); shown behind an expand control. */
  commandBody?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** A turn was killed mid-response here; renders as the interrupted marker row. */
  isInterruptMarker?: boolean;
  /** The planner wrote memory here; renders as the memory-updated marker row. */
  isMemoryUpdate?: boolean;
  /** Memory-relative paths written in the burst this row marks. */
  memoryFiles?: string[];
  /** Per-file excerpt of the real change (plain diff lines), keyed by path. */
  memoryDiffs?: Record<string, string[]>;
  /** Exact elapsed time for a completed status-bearing row. */
  durationMs?: number;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export interface ClaudeSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface ClaudePermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export type SessionNavigationOptions = {
  replace?: boolean;
};

export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
  /** Origin tag the session was created with, so optimistic session rows carry it. */
  origin?: 'direct' | 'planner' | null;
};

export interface ChatInterfaceProps {
  isActive: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  processingSessions?: SessionActivityMap;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  /**
   * The pane's own New Session action. A model picked from the other
   * provider's group while a chat is open starts a new session on that engine
   * through it (a chat never changes engine mid-conversation).
   */
  onStartNewSession?: () => void;
  /** Slash command auto-sent on a New Session trigger; defaults to /planner. */
  bootCommandName?: string;
  /** Origin tag recorded on sessions this surface creates ('direct' worker pane, 'planner' main surface). */
  sessionOrigin?: 'direct' | 'planner' | null;
  /** Reports the session id this surface actually renders, so the host pane can flag a claim/stream mismatch. */
  onRenderedSessionChange?: (sessionId: string | null) => void;
  /**
   * Holds the queued-draft idle flush (ui14 job 11): while the pane's shell
   * view is open, the turn ending hands the session to an interactive
   * `claude --resume`, so an auto-send would race it as a second writer.
   */
  holdQueuedFlush?: boolean;
  onTaskClick?: (...args: unknown[]) => void;
}
