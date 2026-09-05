import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { MarkSessionProcessing, SessionActivityMap } from '../../../hooks/useSessionProtection';
import { grantClaudeToolPermission } from '../utils/chatPermissions';
import {
  draftClientId,
  emptyComposerDraft,
  fetchComposerDraft,
  sameDraftAttachments,
  saveComposerDraft,
  type ComposerDraft,
} from '../utils/composerDrafts';
import {
  claimNextQueuedMessage,
  clearQueuedMessage,
  createQueuedMessageId,
  readQueuedMessages,
  subscribeQueuedMessages,
  safeLocalStorage,
  writeQueuedMessage,
  type QueuedSendOptions,
  type StoredQueuedMessage,
} from '../utils/chatStorage';
import type {
  ChatAttachment,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  SessionEstablishedContext,
} from '../types/types';
import type { Project, ProjectSession, LLMProvider, ProviderModelOption } from '../../../types/app';
import { STANDALONE_PROJECT_ID } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import { buildCommandMessage, commandDisplayText, parseCommandMessage } from '../utils/commandMessage';

import { useFileMentions } from './useFileMentions';
import type { MessageEditContext } from './useMessageVersions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  resolvePermissionModeForProvider: (provider: LLMProvider, requestedMode: PermissionMode | string) => PermissionMode;
  /**
   * Model every send and command carries: the open session's model when there
   * is one, otherwise the user's per-provider selection.
   */
  currentProviderModel: string;
  currentProviderEffort: string;
  currentProviderFastMode: boolean;
  isLoading: boolean;
  /** Holds the queued-draft idle flush while the pane's shell view owns the session (ui14 job 11). */
  holdQueuedFlush?: boolean;
  processingSessions?: SessionActivityMap;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionProcessing?: MarkSessionProcessing;
  /**
   * Invoked with the freshly allocated session id when the user sends the
   * first message of a brand-new conversation. The backend allocates the id
   * via POST /api/providers/sessions BEFORE the websocket send, so the id is
   * stable for the conversation's whole lifetime — the consumer navigates to
   * /session/:id and records it as the current session.
   */
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  /** Monotonic counter from useProjectsState; each increment is one explicit New Session action. */
  newSessionTrigger?: number;
  bootCommandName?: string;
  sessionOrigin?: 'direct' | 'planner' | null;
  /** Boot lifecycle owned by ChatInterface (the message-derived transitions live there). */
  bootState: BootState;
  setBootState: Dispatch<SetStateAction<BootState>>;
  /** Called when a send is an edit-and-resend, so the version state mirrors it. */
  onEditResend?: (edit: MessageEditContext, content: string) => void;
  /** Called on every normal send, so version groups flip back to latest. */
  onPlainSend?: () => void;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Partial<Record<LLMProvider, string[]>>;
  availableModels?: string[];
  availableOptions?: ProviderModelOption[];
  defaultModel?: string;
};

export type CostCommandData = {
  tokenUsage?: {
    used?: number;
    total?: number;
  };
  tokenBreakdown?: {
    input?: number;
    output?: number;
  };
  provider?: string;
  model?: string;
};

export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

/**
 * Lifecycle of the auto-sent New Session boot (/planner or /worker).
 * `sessionId` is null until the boot submission establishes one; `attempt`
 * increments per boot attempt so failure detection can baseline per attempt.
 */
export type BootState = {
  phase: 'idle' | 'booting' | 'failed';
  sessionId: string | null;
  attempt: number;
  /** One plain line for a failure the server explained (ui17 job 17). */
  reason?: string | null;
};

export type CommandModalKind = 'help' | 'models' | 'cost' | 'status';

export type CommandModalPayload = {
  kind: CommandModalKind;
  data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData;
};

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/** How long the clear-with-undo affordance lasts before the clear finalizes. */
export const CLEAR_UNDO_WINDOW_MS = 4000;

/**
 * A text paste longer than this collapses into a pasted-text file attachment
 * (Claude-desktop style) instead of flooding the textarea. The file rides the
 * existing attachment path: uploaded to /api/assets/files when attached and
 * referenced through the provider-neutral <files_input> block.
 */
const PASTE_AS_FILE_THRESHOLD = 2000;

const isImageAttachment = (attachment: ChatAttachment) => {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return /\.(gif|jpe?g|png|svg|webp)$/i.test(attachment.path || attachment.name || '');
};

const uploadAttachmentFiles = async (files: File[]): Promise<unknown[]> => {
  if (files.length === 0) {
    return [];
  }

  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await authenticatedFetch('/api/assets/files', {
    method: 'POST',
    headers: {},
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Failed to upload files');
  }

  const result = await response.json();
  if (!Array.isArray(result.attachments) || result.attachments.length !== files.length) {
    throw new Error('File upload returned an incomplete result');
  }
  return result.attachments;
};

export type QueuedDraft = {
  /** Client-generated message id shared with the server row. */
  id: string;
  content: string;
  /** Browser files retained while this composer stays mounted, for editing. */
  attachments: File[];
  /** JSON-safe descriptors uploaded when the message is queued. */
  uploadedAttachments?: unknown[];
  /**
   * Send options snapshotted at queue time. Persisted with the draft so the
   * app-level auto-send can dispatch the message with the right model and
   * permission settings while another session is being viewed.
   */
  options?: QueuedSendOptions;
  /**
   * Leave the composer untouched after sending. Set by sends whose content
   * never lived in the composer (the rerun action), so an unsent typed draft
   * survives the submission.
   */
  preserveComposer?: boolean;
  /** The device-local outbox is still waiting for the server to receive this row. */
  pendingReceipt?: boolean;
};

type ComposerSubmit = (
  event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
  queuedSubmission?: QueuedDraft,
) => Promise<void>;

/**
 * Sends programmatic command content through the normal submit path without
 * staging it in the user-owned composer state. `preserveComposer` also keeps
 * text entered while command expansion is in flight from being cleared when
 * the request finally submits.
 */
export const submitExpandedCommand = (
  submit: ComposerSubmit | null,
  content: string,
): Promise<void> | undefined => submit?.(createFakeSubmitEvent(), {
  id: createQueuedMessageId(),
  content,
  attachments: [],
  preserveComposer: true,
});

const restoreQueuedDrafts = (sessionKey: string): QueuedDraft[] =>
  readQueuedMessages(sessionKey).map((saved) => ({
    id: saved.id,
    content: saved.content,
    attachments: [],
    uploadedAttachments: saved.attachments ?? saved.images,
    options: saved.options,
    pendingReceipt: saved.pendingReceipt,
  }));

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  resolvePermissionModeForProvider,
  currentProviderModel,
  currentProviderEffort,
  currentProviderFastMode,
  isLoading,
  holdQueuedFlush = false,
  processingSessions,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionProcessing,
  onSessionEstablished,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  scrollToBottom,
  addMessage,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
  newSessionTrigger,
  bootCommandName,
  sessionOrigin,
  bootState,
  setBootState,
  onEditResend,
  onPlainSend,
}: UseChatComposerStateArgs) {
  // Drafts are server-persisted per session (ui8 phase 2); the load effect
  // below fills the input, so the composer mounts empty.
  const [input, setInput] = useState('');
  // Edit-and-resend (ui9 B3): armed while a send should silently replace a
  // past exchange. Set only by a queued edit pulled back for more typing —
  // the pencil flow itself sends straight from the inline transcript editor.
  const editContextRef = useRef<MessageEditContext | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  /** Draft attachments already uploaded to the asset store, restorable anywhere. */
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [commandModalPayload, setCommandModalPayload] = useState<CommandModalPayload | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const textareaLineHeightRef = useRef<number | null>(null);
  const lastAutosizedInputRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const selectedProjectId = selectedProject?.projectId;
  // Prefer the stable backend-allocated id (selectedSession.id) but fall back
  // to currentSessionId for a just-established session that hasn't been
  // handed back to the parent's `selectedSession` prop yet.
  const sessionKey = selectedSession?.id || currentSessionId || null;
  const sessionKeyRef = useRef(sessionKey);
  const processingSessionsRef = useRef<SessionActivityMap | undefined>(processingSessions);
  sessionKeyRef.current = sessionKey;
  processingSessionsRef.current = processingSessions;

  const { subscribe, isConnected } = useWebSocket();
  // One draft per composer surface: the session when one is open, otherwise
  // the project's new-chat composer. Keyed by projectId so drafts survive
  // display-name changes.
  const draftKey = sessionKey ?? (selectedProjectId ? `project:${selectedProjectId}` : null);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  // Last-synced draft per key (server truth as this tab knows it). The save
  // effect only PUTs when the live value diverges from this.
  const draftCacheRef = useRef(new Map<string, ComposerDraft>());
  // Synchronous mirrors: handleSubmit and the background-upload completions
  // read these instead of state so a session switch mid-commit can never mix
  // one chat's attachments into another.
  const draftAttachmentsRef = useRef<ChatAttachment[]>([]);
  const attachedFilesRef = useRef<File[]>([]);
  // In-flight attach-time uploads; send awaits these instead of re-uploading.
  const pendingUploadsRef = useRef(new Map<File, Promise<ChatAttachment | null>>());

  const setAttachedFilesSync = useCallback((next: File[]) => {
    attachedFilesRef.current = next;
    setAttachedFiles(next);
  }, []);

  const setDraftAttachmentsSync = useCallback((next: ChatAttachment[]) => {
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
  }, []);

  const applyDraftToComposer = useCallback((draft: ComposerDraft) => {
    setInput(draft.content);
    inputValueRef.current = draft.content;
    setDraftAttachmentsSync(draft.attachments);
  }, [setDraftAttachmentsSync]);

  // The session's queued-message stack in delivery order (ui15 job 2). The
  // server store is written imperatively at each queue/edit/delete, so no
  // state-sync persistence effect exists to misfire across a session switch.
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>(() => {
    if (typeof window === 'undefined' || !sessionKey) {
      return [];
    }
    return restoreQueuedDrafts(sessionKey);
  });

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'help':
          setCommandModalPayload({
            kind: 'help',
            data: (data || {}) as HelpCommandData,
          });
          break;

        case 'models':
          setCommandModalPayload({
            kind: 'models',
            data: (data || {}) as ModelCommandData,
          });
          break;

        case 'cost': {
          setCommandModalPayload({
            kind: 'cost',
            data: (data || {}) as CostCommandData,
          });
          break;
        }

        case 'status': {
          setCommandModalPayload({
            kind: 'status',
            data: (data || {}) as StatusCommandData,
          });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage],
  );

  const closeCommandModal = useCallback(() => {
    setCommandModalPayload(null);
  }, []);

  const handleCustomCommand = useCallback(async (
    result: CommandExecutionResult,
    commandInfo?: { name: string; description: string; args: string },
  ) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    // Slash commands travel in the tagged command wrapper so the transcript
    // renders a compact command bubble (name + description, expanded text
    // behind an expand control) identically live and on reload. The expanded
    // body itself is unchanged; Claude Code serializes its own local
    // commands with the same tags.
    const commandContent = commandInfo?.name
      ? buildCommandMessage({
          name: commandInfo.name,
          description: commandInfo.description,
          args: commandInfo.args,
          body: content || '',
        })
      : content || '';
    await submitExpandedCommand(handleSubmitRef.current, commandContent);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, options?: { preserveInput?: boolean }) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        // A command chosen from the typed slash palette owns that invocation,
        // so remove only the text the user just executed. Button/boot callers
        // explicitly preserve any draft already in the composer.
        if (commandMatch && !options?.preserveInput) {
          setInput('');
          inputValueRef.current = '';
        }

        // The `/api/commands/execute` context sends `projectId` now instead of
        // a folder-derived project name; the path is still included verbatim.
        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectId: selectedProject.projectId,
          sessionId: currentSessionId || selectedSession?.id || null,
          provider,
          model: currentProviderModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          if (!options?.preserveInput) {
            setInput('');
            inputValueRef.current = '';
          }
        } else if (result.type === 'custom') {
          await handleCustomCommand(result, {
            name: command.name,
            description: command.description ?? '',
            args: args.join(' '),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        // A failed command is an error, not assistant prose; the boot failure
        // detection also keys off the error type.
        addMessage({
          type: 'error',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      currentProviderModel,
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      selectedSession?.id,
      addMessage,
      tokenBudget,
    ],
  );

  const showCostModal = useCallback(() => {
    executeCommand(
      {
        name: '/cost',
        description: 'Display token usage information',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/cost',
      { preserveInput: true },
    );
  }, [executeCommand]);

  const {
    slashCommands,
    slashCommandsCount,
    commandsFetchState,
    commandsFetchSeq,
    refreshSlashCommands,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    provider,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  // The composer's Handoff button rides the same custom-command path as
  // typing /handoff: /api/commands/execute expands ~/.claude/commands/handoff.md
  // and the body is sent into the current session.
  const runHandoff = useCallback(() => {
    const handoffCommand = slashCommands.find((command) => command.name === '/handoff');
    if (!handoffCommand) {
      return;
    }
    void executeCommand(handoffCommand, handoffCommand.name, { preserveInput: true });
  }, [slashCommands, executeCommand]);

  // A New Session action boots the planner automatically. The provider layer
  // has no slash-command passthrough, so this rides the same custom-command
  // path as typing /planner: /api/commands/execute expands
  // ~/.claude/commands/planner.md and the body is sent as the first message.
  // Fires once per trigger increment, waiting until the command list has
  // loaded and the chat state has reset to "no session".
  //
  // The boot is silent: the composer locks and the boot prompt hides while
  // `bootState` is not idle. ChatInterface owns the state and flips the phase
  // to idle when the boot turn completes with a ready message, or to failed
  // when the turn errors or ends without one.
  //
  // Claim ticket consumed by the next handleSubmit run: marks that submission
  // as the auto-sent boot prompt (placeholder title, bootPrompt send flag).
  const bootSubmissionRef = useRef(false);
  // Armed by retryBoot; the retry effect fires the boot once the refreshed
  // command list lands.
  const pendingBootRetryRef = useRef<{ seqAtRequest: number } | null>(null);
  // One boot click creates exactly one session row: while a fired boot has
  // not yet established its session (or failed), further triggers are
  // swallowed instead of firing a second concurrent boot. Once the session
  // row exists the normal currentSessionId guard takes over.
  const bootInFlightRef = useRef(false);
  useEffect(() => {
    if (bootState.phase !== 'booting' || bootState.sessionId) {
      bootInFlightRef.current = false;
    }
  }, [bootState.phase, bootState.sessionId]);
  const lastPlannerBootTriggerRef = useRef(newSessionTrigger ?? 0);
  useEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === lastPlannerBootTriggerRef.current) {
      return;
    }
    if (bootInFlightRef.current) {
      lastPlannerBootTriggerRef.current = trigger;
      return;
    }
    if (selectedSession || currentSessionId || isLoading) {
      return;
    }
    // Standalone chats are plain conversations: no planner boot in scratch.
    if (selectedProject?.projectId === STANDALONE_PROJECT_ID) {
      lastPlannerBootTriggerRef.current = trigger;
      return;
    }
    // Lock the fresh view right away, even while the command list still loads.
    setBootState((previous) =>
      previous.phase === 'booting' && previous.sessionId === null
        ? previous
        : { phase: 'booting', sessionId: null, attempt: previous.attempt + 1 },
    );
    const bootCommand = slashCommands.find((command) => command.name === (bootCommandName ?? '/planner'));
    if (!bootCommand) {
      // Still loading keeps the trigger unconsumed (the effect re-fires when
      // the list arrives). A finished fetch without the boot command is a dead
      // boot: surface it instead of leaving a silent dead session.
      if (commandsFetchState !== 'loading') {
        lastPlannerBootTriggerRef.current = trigger;
        setBootState((previous) => ({ ...previous, phase: 'failed' }));
      }
      return;
    }
    lastPlannerBootTriggerRef.current = trigger;
    bootSubmissionRef.current = true;
    bootInFlightRef.current = true;
    void executeCommand(bootCommand, bootCommand.name, { preserveInput: true });
  }, [newSessionTrigger, selectedSession, currentSessionId, isLoading, slashCommands, commandsFetchState, executeCommand, bootCommandName, selectedProject?.projectId, setBootState]);

  // A different project means a different boot context; drop any stale state.
  useEffect(() => {
    pendingBootRetryRef.current = null;
    setBootState({ phase: 'idle', sessionId: null, attempt: 0 });
  }, [selectedProjectId, setBootState]);

  // Retry re-sends the boot command: into the same session when one was
  // established (the transcript keeps hiding pre-ready boot prompts), or as a
  // fresh session-creating submission when the failure happened before one.
  // The command list is refetched first — an outage that failed the boot has
  // usually emptied it too — and the effect below fires the boot once the
  // refreshed list lands (or fails again when the refetch comes back dry).
  const [bootRetryTick, setBootRetryTick] = useState(0);
  const retryBoot = useCallback(() => {
    setBootState((previous) => ({
      ...previous,
      phase: 'booting',
      // A persisted-failed boot retried from a reopened session has no local
      // boot record; bind the attempt to the open session so the boot view
      // tracks it and the resend targets the same session.
      sessionId: previous.sessionId ?? currentSessionId ?? null,
      attempt: previous.attempt + 1,
      // The previous failure's line goes with it (ui17 job 21): a second
      // failure writes its own, so the row never shows a stale reason.
      reason: null,
    }));
    pendingBootRetryRef.current = { seqAtRequest: commandsFetchSeq };
    setBootRetryTick((tick) => tick + 1);
    refreshSlashCommands();
  }, [commandsFetchSeq, currentSessionId, refreshSlashCommands, setBootState]);

  useEffect(() => {
    const pending = pendingBootRetryRef.current;
    if (!pending) {
      return;
    }
    const bootCommand = slashCommands.find((command) => command.name === (bootCommandName ?? '/planner'));
    if (bootCommand) {
      pendingBootRetryRef.current = null;
      // A trigger-fired boot already in flight covers this retry.
      if (!bootInFlightRef.current) {
        bootSubmissionRef.current = true;
        bootInFlightRef.current = true;
        void executeCommand(bootCommand, bootCommand.name, { preserveInput: true });
      }
      return;
    }
    // A post-retry fetch completed and the boot command is still missing.
    if (commandsFetchSeq > pending.seqAtRequest && commandsFetchState !== 'loading') {
      pendingBootRetryRef.current = null;
      setBootState((previous) => (previous.phase === 'failed' ? previous : { ...previous, phase: 'failed' }));
    }
  }, [bootRetryTick, slashCommands, commandsFetchSeq, commandsFetchState, executeCommand, bootCommandName, setBootState]);

  const markBootReady = useCallback(() => {
    setBootState((previous) => (previous.phase === 'idle' ? previous : { ...previous, phase: 'idle' }));
  }, []);

  const markBootFailed = useCallback(() => {
    setBootState((previous) => (previous.phase === 'failed' ? previous : { ...previous, phase: 'failed' }));
  }, []);

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const resizeTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    const nextHeight = Math.max(22, target.scrollHeight);
    target.style.height = `${nextHeight}px`;

    let lineHeight = textareaLineHeightRef.current;
    if (!lineHeight) {
      lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      textareaLineHeightRef.current = Number.isFinite(lineHeight) ? lineHeight : 24;
    }

    const expanded = nextHeight > (textareaLineHeightRef.current || 24) * 2;
    setIsTextareaExpanded((previous) => previous === expanded ? previous : expanded);
    lastAutosizedInputRef.current = target.value;
  }, []);

  // Drafts persist attachments as uploaded descriptors, so files upload the
  // moment they are attached; each File chip swaps to its durable descriptor
  // on success and the descriptor rides the draft to the server.
  const beginBackgroundUpload = useCallback((files: File[]) => {
    files.forEach((file) => {
      const promise = uploadAttachmentFiles([file])
        .then((descriptors) => {
          pendingUploadsRef.current.delete(file);
          const descriptor = (descriptors[0] ?? null) as ChatAttachment | null;
          // Only swap while the file is still attached — a send or removal
          // that raced the upload keeps the composer clear.
          if (descriptor && attachedFilesRef.current.includes(file)) {
            setAttachedFilesSync(attachedFilesRef.current.filter((candidate) => candidate !== file));
            setDraftAttachmentsSync([...draftAttachmentsRef.current, descriptor]);
          }
          return descriptor;
        })
        .catch((error: unknown) => {
          pendingUploadsRef.current.delete(file);
          const message = error instanceof Error ? error.message : 'Upload failed';
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(file.name, message);
            return next;
          });
          return null;
        });
      pendingUploadsRef.current.set(file, promise);
    });
  }, [setAttachedFilesSync, setDraftAttachmentsSync]);

  // Send-time resolution: await any in-flight attach-time upload; a file whose
  // background upload failed (or never ran) uploads here so a failure still
  // surfaces as a send error instead of silently dropping the file.
  const resolveAttachmentUploads = useCallback(async (files: File[]): Promise<unknown[]> => {
    const results: unknown[] = [];
    for (const file of files) {
      const pending = pendingUploadsRef.current.get(file);
      const fromPending = pending ? await pending : null;
      if (fromPending) {
        results.push(fromPending);
        continue;
      }
      const [descriptor] = await uploadAttachmentFiles([file]);
      results.push(descriptor);
    }
    return results;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          const fileName = file.name || 'Unknown file';
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 10MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      const room = Math.max(
        0,
        MAX_ATTACHMENT_COUNT - attachedFilesRef.current.length - draftAttachmentsRef.current.length,
      );
      const accepted = validFiles.slice(0, room);
      if (accepted.length === 0) {
        return;
      }
      setAttachedFilesSync([...attachedFilesRef.current, ...accepted]);
      beginBackgroundUpload(accepted);
    }
  }, [beginBackgroundUpload, setAttachedFilesSync]);

  // Monotonic naming for pasted-text attachments: the upload progress and
  // error maps key by file name, so every pasted file needs a distinct one.
  const pastedFileCounterRef = useRef(0);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = event.clipboardData.getData('text/plain');
      if (pastedText.length > PASTE_AS_FILE_THRESHOLD) {
        event.preventDefault();
        pastedFileCounterRef.current += 1;
        const count = pastedFileCounterRef.current;
        const fileName = count === 1 ? 'Pasted text.txt' : `Pasted text ${count}.txt`;
        handleAttachmentFiles([new File([pastedText], fileName, { type: 'text/plain' })]);
        return;
      }

      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleAttachmentFiles(imageFiles);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE,
    maxFiles: MAX_ATTACHMENT_COUNT,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  // Snapshot of everything `chat.send` needs beyond the text itself. Built at
  // send time for immediate sends and at queue time for queued ones, so a
  // queued message keeps the provider settings it was composed under even if
  // it is later dispatched outside this composer (app-level auto-send).
  const buildSendOptions = useCallback((currentInput: string): QueuedSendOptions => {
    const getToolsSettings = () => {
      try {
        const settingsKey =
          provider === 'cursor'
            ? 'cursor-tools-settings'
            : provider === 'codex'
              ? 'codex-settings'
              : provider === 'opencode'
                  ? 'opencode-settings'
                : 'claude-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }

      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
      };
    };

    const toolsSettings = getToolsSettings();

    return {
      model: currentProviderModel,
      effort: currentProviderEffort,
      fastMode: currentProviderFastMode,
      permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
      toolsSettings,
      skipPermissions: toolsSettings?.skipPermissions || false,
      sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
    };
  }, [
    currentProviderEffort,
    currentProviderFastMode,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
    selectedSession,
  ]);

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => {
      event.preventDefault();
      const currentInput = queuedSubmission?.content ?? inputValueRef.current;
      const currentAttachments = queuedSubmission?.attachments ?? attachedFilesRef.current;
      // Already-uploaded draft attachments (attach-time uploads); a queued
      // submission carries its own descriptors instead.
      const currentDraftDescriptors = queuedSubmission ? [] : draftAttachmentsRef.current;
      const previouslyUploadedAttachments = queuedSubmission?.uploadedAttachments ?? [];
      if (
        (
          !currentInput.trim()
          && currentAttachments.length === 0
          && currentDraftDescriptors.length === 0
          && previouslyUploadedAttachments.length === 0
        )
        || !selectedProject
      ) {
        return;
      }

      // Consume the boot claim ticket: this submission is the auto-sent boot
      // prompt exactly when the boot effect (or retry) armed it just before.
      const isBootSubmission = bootSubmissionRef.current;
      bootSubmissionRef.current = false;

      // A turn is already in flight, or the socket is down and a send frame
      // would go nowhere: stash this message in the server queue instead of
      // sending it (a dead socket never buffers a send client-side, ui12
      // phase 1). Upload attached files now so the queued record contains
      // durable image descriptors that can be sent even if another session is
      // open later.
      if (isLoading || !isConnected) {
        // A run can restart in the tiny gap between scheduling and flushing a
        // queued submission. Put the same durable draft back without uploading
        // its files again.
        if (queuedSubmission) {
          if (sessionKey) {
            writeQueuedMessage(sessionKey, {
              id: queuedSubmission.id,
              content: queuedSubmission.content,
              options: queuedSubmission.options,
              attachments: queuedSubmission.uploadedAttachments,
            });
          }
          // The server re-append lands it at the stack's tail; mirror that.
          setQueuedDrafts((previous) => [
            ...previous.filter((draft) => draft.id !== queuedSubmission.id),
            { ...queuedSubmission, pendingReceipt: Boolean(sessionKey) },
          ]);
          return;
        }

        const queuedOptions = buildSendOptions(currentInput);
        // An armed edit rides the queued options so the eventual flush (or
        // app-level auto-send) still records the resend as a version.
        if (editContextRef.current) {
          queuedOptions.edit = editContextRef.current;
          editContextRef.current = null;
        }
        const queuedSessionKey = sessionKey;
        let uploadedAttachments: unknown[] = [];
        try {
          uploadedAttachments = [
            ...currentDraftDescriptors,
            ...(await resolveAttachmentUploads(currentAttachments)),
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Queued file upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        const durableDraft: QueuedDraft = {
          id: createQueuedMessageId(),
          content: currentInput,
          attachments: currentAttachments,
          uploadedAttachments,
          options: queuedOptions,
          pendingReceipt: Boolean(queuedSessionKey),
        };
        if (queuedSessionKey) {
          // Append to the server stack synchronously after upload, so the
          // claim ticket exists before any flush can race it. Queueing while
          // messages are already queued stacks behind them (ui15 job 2).
          writeQueuedMessage(queuedSessionKey, {
            id: durableDraft.id,
            content: durableDraft.content,
            options: durableDraft.options,
            attachments: durableDraft.uploadedAttachments,
          });
        }

        // The upload is asynchronous. If the user changed sessions while it
        // was running, persist/send against the session where Queue was
        // pressed rather than putting the draft into the newly opened chat.
        // Claim only while connected — a dead socket cannot deliver, so the
        // row stays queued for the flush/auto-send after reconnect.
        if (queuedSessionKey && sessionKeyRef.current !== queuedSessionKey) {
          if (
            isConnected
            && processingSessionsRef.current
            && !processingSessionsRef.current.has(queuedSessionKey)
          ) {
            void claimNextQueuedMessage(queuedSessionKey).then((popped) => {
              if (!popped) {
                return;
              }
              sendMessage({
                type: 'chat.send',
                sessionId: queuedSessionKey,
                content: popped.content,
                options: {
                  ...(popped.options ?? {}),
                  attachments: popped.attachments ?? [],
                },
              });
              onSessionProcessing?.(queuedSessionKey, { statusText: null, canInterrupt: true });
            });
          }
          return;
        }

        setQueuedDrafts((previous) => [
          ...previous.filter((draft) => draft.id !== durableDraft.id),
          durableDraft,
        ]);
        setInput('');
        inputValueRef.current = '';
        setAttachedFilesSync([]);
        setDraftAttachmentsSync([]);
        setUploadingFiles(new Map());
        setFileErrors(new Map());
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        // The message now lives in the queue; delete the server draft right
        // away so other devices clear too.
        if (draftKeyRef.current) {
          draftCacheRef.current.set(draftKeyRef.current, emptyComposerDraft);
          saveComposerDraft(draftKeyRef.current, '', []);
        }
        return;
      }

      // Intercept slash commands only when "/" is the first input character.
      // Also accept exact "help" as a convenience alias for users who expect CLI-style help.
      const commandInput = currentInput.trimEnd();
      const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
      if (commandInput.startsWith('/') || isHelpAlias) {
        const firstSpace = commandInput.indexOf(' ');
        const commandName = isHelpAlias
          ? '/help'
          : firstSpace > 0 ? commandInput.slice(0, firstSpace) : commandInput;
        const matchedCommand =
          slashCommands.find((cmd: SlashCommand) => cmd.name === commandName) ||
          (commandName === '/help'
            ? ({
                name: '/help',
                description: 'Show help documentation for Claude Code',
                namespace: 'builtin',
                metadata: { type: 'builtin' },
              } as SlashCommand)
            : undefined);
        if (matchedCommand && matchedCommand.type !== 'skill') {
          executeCommand(matchedCommand, isHelpAlias ? '/help' : commandInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedFilesSync([]);
          setDraftAttachmentsSync([]);
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      const messageContent = currentInput;
      // A command wrapper renders (and titles) as its short display text; the
      // full wrapped content still goes to Claude unchanged.
      const parsedCommand = parseCommandMessage(currentInput);
      const commandView = parsedCommand && parsedCommand.name ? parsedCommand : null;
      const displayContent = commandView ? commandDisplayText(commandView) : currentInput;

      let uploadedAttachments = previouslyUploadedAttachments;
      if (!queuedSubmission && (currentAttachments.length > 0 || currentDraftDescriptors.length > 0)) {
        try {
          uploadedAttachments = [
            ...currentDraftDescriptors,
            ...(await resolveAttachmentUploads(currentAttachments)),
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, displayContent);

      // The conversation always has a stable backend-allocated session id
      // BEFORE the first websocket send: brand-new chats allocate one here
      // via the session gateway. There is no client-visible session-id
      // handoff later — this id stays valid for the conversation's lifetime.
      let targetSessionId = selectedSession?.id || currentSessionId || null;
      if (!targetSessionId) {
        let createdSessionName = sessionSummary;
        try {
          const response = await authenticatedFetch('/api/providers/sessions', {
            method: 'POST',
            body: JSON.stringify({
              provider,
              projectPath: resolvedProjectPath,
              initialMessage: displayContent,
              origin: sessionOrigin ?? undefined,
              boot: isBootSubmission || undefined,
            }),
          });
          if (!response.ok) {
            throw new Error(`Failed to create session (${response.status})`);
          }
          const body = await response.json();
          targetSessionId = body?.data?.sessionId || null;
          // A blank server name would leave the session unlabeled, so the local
          // summary stays the fallback unless a real name comes back.
          const returnedSessionName = typeof body?.data?.sessionName === 'string'
            ? body.data.sessionName.trim()
            : '';
          if (returnedSessionName) {
            createdSessionName = returnedSessionName;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Session creation failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to start a new session: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        if (!targetSessionId) {
          addMessage({
            type: 'error',
            content: 'Failed to start a new session: no session id returned.',
            timestamp: new Date(),
          });
          return;
        }

        onSessionEstablished?.(targetSessionId, {
          provider,
          project: selectedProject,
          summary: createdSessionName,
          origin: sessionOrigin ?? null,
        });
      }

      // Tie an in-flight boot to its now-concrete session so the composer
      // lock and ready/failed detection stay scoped to this session.
      if (isBootSubmission && targetSessionId) {
        const bootSessionId = targetSessionId;
        setBootState((previous) =>
          previous.phase === 'idle' || previous.sessionId === bootSessionId
            ? previous
            : { ...previous, sessionId: bootSessionId },
        );
      }

      // Edit-and-resend: armed from the composer, or riding a queued draft's
      // snapshotted options. Registering the version BEFORE the optimistic
      // bubble is appended keeps the version's start time ahead of the echo,
      // so the prior exchange hides and this send renders as its one bubble.
      const editPayload = (queuedSubmission
        ? queuedSubmission.options?.edit
        : editContextRef.current) as MessageEditContext | undefined | null;
      if (editPayload) {
        onEditResend?.(editPayload, messageContent);
        editContextRef.current = null;
      } else {
        // A normal send continues the latest thread: flip any group viewed on
        // an older version back to latest so this turn never lands hidden.
        onPlainSend?.();
      }

      const attachmentRecords = uploadedAttachments as ChatAttachment[];
      const userMessage: ChatMessage = {
        type: 'user',
        content: displayContent,
        ...(commandView
          ? {
              commandName: commandView.name,
              commandMessage: commandView.description,
              commandArgs: commandView.args,
              commandBody: commandView.body || undefined,
              isLocalCommand: true,
            }
          : {}),
        images: attachmentRecords.filter(isImageAttachment),
        files: attachmentRecords.filter((attachment) => !isImageAttachment(attachment)),
        timestamp: new Date(),
      };

      addMessage(userMessage);
      // Mark this request as processing in the per-session activity map (the
      // single source of truth the indicator derives from). The id is always
      // concrete at this point — no pending placeholder exists anymore.
      onSessionProcessing?.(targetSessionId, {
        statusText: null,
        canInterrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      // One message shape for every provider. The backend resolves the
      // provider, project path, and provider-native resume id from the
      // session row; `options` only carries composer-level preferences.
      sendMessage({
        type: 'chat.send',
        sessionId: targetSessionId,
        content: messageContent,
        options: {
          ...(queuedSubmission?.options ?? buildSendOptions(messageContent)),
          attachments: uploadedAttachments,
          // Auto-sent boot prompts never title the session server-side.
          bootPrompt: isBootSubmission || undefined,
          // Server-side version bookkeeping; stripped before the runtime.
          edit: editPayload || undefined,
        },
      });

      // A send whose content never lived in the composer (rerun) leaves any
      // typed-but-unsent draft exactly as it was.
      if (queuedSubmission?.preserveComposer) {
        return;
      }

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedFilesSync([]);
      setDraftAttachmentsSync([]);
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // The message is sent; delete the server draft right away so other
      // devices clear too (the debounced save would lag half a second).
      if (draftKeyRef.current) {
        draftCacheRef.current.set(draftKeyRef.current, emptyComposerDraft);
        saveComposerDraft(draftKeyRef.current, '', []);
      }
    },
    [
      selectedSession,
      buildSendOptions,
      currentSessionId,
      executeCommand,
      isConnected,
      isLoading,
      onSessionProcessing,
      onSessionEstablished,
      provider,
      resetCommandMenuState,
      resolveAttachmentUploads,
      scrollToBottom,
      selectedProject,
      sendMessage,
      sessionKey,
      setAttachedFilesSync,
      setDraftAttachmentsSync,
      addMessage,
      setIsUserScrolledUp,
      slashCommands,
      sessionOrigin,
      onEditResend,
      onPlainSend,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // Once the in-flight turn ends, replay the queued draft through the normal
  // submit path. The draft itself is passed directly so submission never
  // depends on React committing restored attachment state first.
  const wasLoadingRef = useRef(isLoading);
  const flushSessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;

    // A session switch changes which session `isLoading` describes, so this
    // transition says nothing about the queued draft's own session. Never
    // flush across it — the swap effect below replaces `queuedDraft` with the
    // new session's saved draft right after this.
    if (flushSessionKeyRef.current !== sessionKey) {
      flushSessionKeyRef.current = sessionKey;
      return;
    }

    // The shell view owns the session while it is open: the turn ending hands
    // it to an interactive `claude --resume`, so flushing here would start an
    // SDK turn against the same session file (ui14 job 11). The drafts stay
    // queued; this effect re-runs when the shell closes.
    if (isLoading || holdQueuedFlush || queuedDrafts.length === 0) {
      return;
    }

    // A dead socket cannot deliver a send. The message stays in the server
    // queue and this effect re-runs when `isConnected` flips true — client
    // memory never replays a send on its own (ui12 phase 1).
    if (!isConnected) {
      return;
    }

    // Turn just ended in this session: flush immediately. Otherwise this is a
    // saved draft restored into an apparently idle session — hold it briefly
    // so the `chat_subscribed` ack can flip `isLoading` if a run is actually
    // still live (the cleanup below cancels the send in that case).
    const delay = wasLoading ? 0 : 750;
    const localHead = queuedDrafts[0];
    let cancelled = false;
    const timer = setTimeout(() => {
      // The server row is the claim ticket shared with the app-level auto-send
      // and with this session's composer on every other device: only the
      // client whose delete popped the head sends — and it sends the popped
      // server copy, so a stale device can never send outdated content. A
      // brand-new chat has no server rows yet; its in-memory head stands in
      // for the pop. Later messages stay queued and flush the same way after
      // this send's turn ends, so delivery preserves queue order.
      const claim: Promise<StoredQueuedMessage | null> = sessionKey
        ? claimNextQueuedMessage(sessionKey)
        : Promise.resolve({
            id: localHead.id,
            content: localHead.content,
            options: localHead.options,
            attachments: localHead.uploadedAttachments,
          });
      void claim.then((popped) => {
        if (cancelled) {
          // The effect re-ran while the claim was in flight (a run turned out
          // to be live, or the session changed): put the popped copy back
          // rather than lose it, and let the next idle moment claim again.
          if (popped && sessionKey) {
            writeQueuedMessage(sessionKey, popped);
          }
          return;
        }
        if (!popped) {
          // Another client claimed the head (or the row is gone): resync the
          // cards to the store instead of dropping the whole stack.
          setQueuedDrafts(sessionKey ? restoreQueuedDrafts(sessionKey) : []);
          return;
        }
        setQueuedDrafts((previous) => previous.filter((draft) => draft.id !== popped.id));
        // Browser File objects only survive in the local draft that queued them.
        const localMatch = popped.id === localHead.id ? localHead : null;
        const submission: QueuedDraft = {
          id: popped.id,
          content: popped.content,
          attachments: localMatch?.attachments ?? [],
          uploadedAttachments: popped.attachments,
          options: popped.options,
          preserveComposer: localMatch?.preserveComposer,
        };
        // A preserveComposer draft (inline edit save, rerun) never lived in
        // the composer; restoring it here would clobber the typed draft.
        if (!submission.preserveComposer) {
          setInput(submission.content);
          inputValueRef.current = submission.content;
          setAttachedFilesSync(submission.attachments);
        }
        handleSubmitRef.current?.(createFakeSubmitEvent(), submission);
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoading, holdQueuedFlush, isConnected, queuedDrafts, sessionKey, setInput, setAttachedFilesSync]);

  const editQueuedDraft = useCallback((id: string) => {
    const draft = queuedDrafts.find((candidate) => candidate.id === id);
    if (!draft) {
      return;
    }
    if (sessionKey) {
      clearQueuedMessage(sessionKey, id);
    }
    setQueuedDrafts((previous) => previous.filter((candidate) => candidate.id !== id));
    // A queued edit-and-resend keeps its armed edit when pulled back for
    // more typing — otherwise the eventual send would duplicate the bubble.
    const queuedEdit = draft.options?.edit as MessageEditContext | undefined;
    if (queuedEdit) {
      editContextRef.current = queuedEdit;
    }
    setInput(draft.content);
    inputValueRef.current = draft.content;
    setAttachedFilesSync(draft.attachments);
    setDraftAttachmentsSync((draft.uploadedAttachments ?? []) as ChatAttachment[]);
    textareaRef.current?.focus({ preventScroll: true });
  }, [queuedDrafts, sessionKey, setAttachedFilesSync, setDraftAttachmentsSync]);

  const deleteQueuedDraft = useCallback((id: string) => {
    if (sessionKey) {
      clearQueuedMessage(sessionKey, id);
    }
    setQueuedDrafts((previous) => previous.filter((candidate) => candidate.id !== id));
  }, [sessionKey]);

  // Save from the inline transcript editor (ui11 phase 13): resend the edited
  // text through the normal submit path as a new version of that exchange,
  // leaving the composer draft untouched. Riding the queued-submission shape
  // means a save during a live run queues like any other message and still
  // carries its edit context to the eventual flush.
  const submitMessageEdit = useCallback((edit: MessageEditContext, content: string) => {
    void handleSubmitRef.current?.(createFakeSubmitEvent(), {
      id: createQueuedMessageId(),
      content,
      attachments: [],
      options: { ...buildSendOptions(content), edit },
      preserveComposer: true,
    });
  }, [buildSendOptions]);

  // An armed edit belongs to one session's transcript; switching drops it.
  useEffect(() => {
    editContextRef.current = null;
  }, [sessionKey]);

  // A voice transcript either fills the input (to edit before sending) or, when the
  // user tapped "stop and send", is submitted straight away. Mirror the value into
  // inputValueRef synchronously so handleSubmit reads the new text, not the stale state.
  const handleVoiceTranscript = useCallback((text: string, send?: boolean) => {
    const base = inputValueRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    inputValueRef.current = next;
    if (send) handleSubmitRef.current?.(createFakeSubmitEvent());
  }, [setInput]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // Switching composer surfaces (session or project) swaps in that surface's
  // draft: the in-memory cache applies instantly, then the server copy (the
  // cross-device truth) replaces it unless the user typed meanwhile. Declared
  // BEFORE the save effect so on the swap commit the synchronous refs already
  // describe the new surface when the save effect runs.
  useEffect(() => {
    const key = draftKey;
    if (!key) {
      applyDraftToComposer(emptyComposerDraft);
      return;
    }
    const cached = draftCacheRef.current.get(key) ?? emptyComposerDraft;
    applyDraftToComposer(cached);
    let cancelled = false;
    void fetchComposerDraft(key).then((draft) => {
      if (cancelled || draftKeyRef.current !== key) {
        return;
      }
      const server = draft ?? emptyComposerDraft;
      draftCacheRef.current.set(key, server);
      if (inputValueRef.current === cached.content) {
        applyDraftToComposer(server);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey, applyDraftToComposer]);

  // Debounced server persistence: PUT whenever the live composer diverges
  // from the last-synced draft (an empty draft deletes the row). Reads the
  // synchronous refs, so the one commit where draftKey changed but the
  // swapped-in state has not rendered yet can never write one chat's text
  // under another chat's key.
  useEffect(() => {
    const key = draftKey;
    if (!key) {
      return;
    }
    const cached = draftCacheRef.current.get(key) ?? emptyComposerDraft;
    const content = inputValueRef.current;
    const attachments = draftAttachmentsRef.current;
    if (cached.content === content && sameDraftAttachments(cached.attachments, attachments)) {
      return;
    }
    const timer = setTimeout(() => {
      draftCacheRef.current.set(key, { content, attachments });
      saveComposerDraft(key, content, attachments);
    }, 500);
    return () => clearTimeout(timer);
  }, [input, draftAttachments, draftKey]);

  // Cross-device sync: another client's draft_updated lands in the cache, and
  // in the live composer when it is showing that draft and has no unsaved
  // local edits (a dirty composer wins through its own imminent save).
  useEffect(() => {
    return subscribe((event) => {
      if (event?.kind !== 'draft_updated') {
        return;
      }
      const key = typeof event.draftKey === 'string' ? event.draftKey : null;
      if (!key || event.clientId === draftClientId) {
        return;
      }
      const previous = draftCacheRef.current.get(key) ?? emptyComposerDraft;
      const next: ComposerDraft = {
        content: typeof event.content === 'string' ? event.content : '',
        attachments: Array.isArray(event.attachments) ? (event.attachments as ChatAttachment[]) : [],
      };
      draftCacheRef.current.set(key, next);
      if (draftKeyRef.current === key && inputValueRef.current === previous.content) {
        applyDraftToComposer(next);
      }
    });
  }, [subscribe, applyDraftToComposer]);

  // Switching sessions swaps in that session's queued stack. Browser File
  // objects are local to the mounted composer, while their already-uploaded
  // descriptors restore from storage and remain sendable.
  useEffect(() => {
    if (!sessionKey) {
      setQueuedDrafts([]);
      return;
    }
    setQueuedDrafts(restoreQueuedDrafts(sessionKey));
  }, [sessionKey]);

  // Another device queued, edited, or cleared this session's messages, the
  // cache hydrated after mount, or a steered delivery settled: mirror the
  // store into the cards. Local Files are retained where ids still match.
  useEffect(() => subscribeQueuedMessages((changedSessionId) => {
    if (changedSessionId !== sessionKey) {
      return;
    }
    setQueuedDrafts((previous) =>
      restoreQueuedDrafts(sessionKey).map((restored) => {
        const local = previous.find((draft) => draft.id === restored.id);
        return local ? { ...restored, attachments: local.attachments } : restored;
      }),
    );
  }), [sessionKey]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    if (lastAutosizedInputRef.current === input) {
      return;
    }
    // Re-run for restored drafts and programmatic input changes. User typing is
    // already resized in onInput, so this avoids doing the same forced layout twice.
    resizeTextarea(textareaRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      resizeTextarea(target);
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);
    },
    [resizeTextarea, setCursorPosition, syncInputOverlayScroll],
  );

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available.');
      return;
    }

    // The backend resolves the provider from the session row, so no provider
    // field is needed here.
    sendMessage({
      type: 'chat.abort',
      sessionId: targetSessionId,
    });
  }, [canAbortSession, currentSessionId, selectedSession?.id, sendMessage]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'chat.permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) =>
        previous.filter((request) => !validIds.includes(request.requestId)),
      );
    },
    [sendMessage, setPendingPermissionRequests],
  );

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFilesSync(attachedFilesRef.current.filter((_, currentIndex) => currentIndex !== index));
  }, [setAttachedFilesSync]);

  const removeDraftAttachment = useCallback((index: number) => {
    setDraftAttachmentsSync(draftAttachmentsRef.current.filter((_, currentIndex) => currentIndex !== index));
  }, [setDraftAttachmentsSync]);

  // Pasted-text edits (ui14 job 6): the edited text becomes a fresh File under
  // the same name, uploaded like any attachment; the old file or descriptor
  // drops out (an in-flight upload of the old File then swaps nothing).
  const replaceAttachedFileText = useCallback((index: number, text: string) => {
    const previous = attachedFilesRef.current[index];
    if (!previous) return;
    const next = new File([text], previous.name, { type: 'text/plain' });
    setAttachedFilesSync(attachedFilesRef.current.map((file, currentIndex) => (currentIndex === index ? next : file)));
    beginBackgroundUpload([next]);
  }, [beginBackgroundUpload, setAttachedFilesSync]);

  const replaceDraftAttachmentText = useCallback((index: number, text: string) => {
    const previous = draftAttachmentsRef.current[index];
    if (!previous) return;
    const name = previous.name || previous.path?.split(/[\\/]/).pop() || 'Pasted text.txt';
    const next = new File([text], name, { type: 'text/plain' });
    setDraftAttachmentsSync(draftAttachmentsRef.current.filter((_, currentIndex) => currentIndex !== index));
    setAttachedFilesSync([...attachedFilesRef.current, next]);
    beginBackgroundUpload([next]);
  }, [beginBackgroundUpload, setAttachedFilesSync, setDraftAttachmentsSync]);

  // Clear-with-undo (ui15 job 2): clearing the composer snapshots the exact
  // prompt and attachments; the Undo affordance restores them until the
  // depleting window runs out, which finalizes the clear.
  const [pendingClear, setPendingClear] = useState<{
    content: string;
    attachedFiles: File[];
    draftAttachments: ChatAttachment[];
  } | null>(null);
  const pendingClearRef = useRef<typeof pendingClear>(null);
  pendingClearRef.current = pendingClear;
  const pendingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finalizePendingClear = useCallback(() => {
    if (pendingClearTimerRef.current) {
      clearTimeout(pendingClearTimerRef.current);
      pendingClearTimerRef.current = null;
    }
    setPendingClear(null);
  }, []);

  const clearComposer = useCallback(() => {
    if (!inputValueRef.current && attachedFilesRef.current.length === 0 && draftAttachmentsRef.current.length === 0) {
      return;
    }
    const snapshot = {
      content: inputValueRef.current,
      attachedFiles: attachedFilesRef.current,
      draftAttachments: draftAttachmentsRef.current,
    };
    setInput('');
    inputValueRef.current = '';
    setAttachedFilesSync([]);
    setDraftAttachmentsSync([]);
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    resetCommandMenuState();
    setIsTextareaExpanded(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (draftKeyRef.current) {
      draftCacheRef.current.set(draftKeyRef.current, emptyComposerDraft);
      saveComposerDraft(draftKeyRef.current, '', []);
    }
    setPendingClear(snapshot);
    if (pendingClearTimerRef.current) {
      clearTimeout(pendingClearTimerRef.current);
    }
    pendingClearTimerRef.current = setTimeout(() => {
      pendingClearTimerRef.current = null;
      setPendingClear(null);
    }, CLEAR_UNDO_WINDOW_MS);
  }, [resetCommandMenuState, setAttachedFilesSync, setDraftAttachmentsSync]);

  const undoClearComposer = useCallback(() => {
    const snapshot = pendingClearRef.current;
    if (!snapshot) {
      return;
    }
    finalizePendingClear();
    setInput(snapshot.content);
    inputValueRef.current = snapshot.content;
    setAttachedFilesSync(snapshot.attachedFiles);
    setDraftAttachmentsSync(snapshot.draftAttachments);
    textareaRef.current?.focus({ preventScroll: true });
  }, [finalizePendingClear, setAttachedFilesSync, setDraftAttachmentsSync]);

  // An undo window belongs to one composer surface; switching drops it.
  useEffect(() => {
    finalizePendingClear();
  }, [draftKey, finalizePendingClear]);
  useEffect(() => () => {
    if (pendingClearTimerRef.current) {
      clearTimeout(pendingClearTimerRef.current);
    }
  }, []);

  // Prompt-history "use" action (ui15 job 2): load a past prompt and its
  // uploaded-attachment descriptors straight into the composer.
  const loadPromptIntoComposer = useCallback((content: string, attachments: ChatAttachment[]) => {
    setInput(content);
    inputValueRef.current = content;
    setAttachedFilesSync([]);
    setDraftAttachmentsSync(attachments);
    textareaRef.current?.focus({ preventScroll: true });
  }, [setAttachedFilesSync, setDraftAttachmentsSync]);

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    replaceAttachedFileText,
    draftAttachments,
    removeDraftAttachment,
    replaceDraftAttachmentText,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker: open,
    handleSubmit,
    queuedDrafts,
    editQueuedDraft,
    deleteQueuedDraft,
    submitMessageEdit,
    clearUndoPending: Boolean(pendingClear),
    clearComposer,
    undoClearComposer,
    loadPromptIntoComposer,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    runHandoff,
    retryBoot,
    markBootReady,
    markBootFailed,
  };
}
