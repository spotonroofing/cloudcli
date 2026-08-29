import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon } from 'lucide-react';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import type { SessionActivityPhase } from '../../../hooks/useSessionProtection';
import { useSessionStore } from '../../../stores/useSessionStore';
import type { LLMProvider } from '../../../types/app';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import type { ChatInterfaceProps, ChatMessage } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState, type BootState } from '../hooks/useChatComposerState';
import { createQueuedMessageId } from '../utils/chatStorage';
import { useMemoryUpdates } from '../hooks/useMemoryUpdates';
import { useMessageVersions } from '../hooks/useMessageVersions';
import { findEditGroupId } from '../utils/messageVersions';
import { createPaneDragTracker, type PaneDragTracker } from '../utils/paneDropHighlight';

import { convertMarkdownToPlainText } from './subcomponents/MessageCopyControl';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import { ChatProjectContext } from './subcomponents/ChatProjectContext';
import CommandResultModal from './subcomponents/CommandResultModal';
import type { ProviderModelGroup } from './subcomponents/ComposerModelMenu';

// Only a real file drag paints the pane: project rows and text drags carry no
// `Files` entry in the transfer types.
function isFileDrag(event: React.DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

function inferLivePhase(messages: ChatMessage[], runStartedAt: number): SessionActivityPhase | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const rowStartedAt = new Date(message.timestamp).getTime();
    const resultAt = message.toolResult?.timestamp
      ? new Date(message.toolResult.timestamp).getTime()
      : Number.NaN;
    if (Math.max(rowStartedAt, resultAt) < runStartedAt) return null;
    if (message.isMemoryUpdate || message.isInterruptMarker) continue;
    if (message.isToolUse) return message.toolResult ? 'thinking' : 'tool';
    if (message.isThinking) return 'thinking';
    if (message.type === 'assistant' && String(message.content || '').trim()) return 'writing';
    if (message.type === 'user') return 'thinking';
  }
  return null;
}

function ChatInterface({
  isActive,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onStartNewSession,
  bootCommandName,
  sessionOrigin,
  onRenderedSessionChange,
  holdQueuedFlush = false,
}: ChatInterfaceProps) {
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    currentProviderEffort,
    currentProviderFastMode,
    currentProviderEffortOptions,
    currentProviderModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelsLoading,
    providerModelActions,
    selectProviderModel,
    selectProviderEffort,
    selectCodexFastMode,
    resolvePermissionModeForProvider,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

  // Lifecycle of the auto-sent New Session boot. The composer hook initiates
  // boots and ties them to their session; the message-derived ready/failed
  // transitions live in the effect below.
  const [bootState, setBootState] = useState<BootState>({ phase: 'idle', sessionId: null, attempt: 0 });

  // Only sessions whose first message was an auto-sent boot prompt hide their
  // prologue: the persisted `booted` stamp covers reopened sessions, and the
  // local latch covers this pane's own boots until the refreshed session
  // payload lands. A chat started by typing never gets its first turn hidden.
  const bootedSessionsRef = useRef(new Set<string>());
  if (bootState.phase !== 'idle' && bootState.sessionId) {
    bootedSessionsRef.current.add(bootState.sessionId);
  }
  const hideBootPrologue =
    Boolean(selectedSession?.booted)
    || bootState.phase !== 'idle'
    || (selectedSession ? bootedSessionsRef.current.has(selectedSession.id) : false);

  // Edit-and-resend version state (ui9 B3). Editing needs an established
  // session with at least one settled turn, so the routed session id is
  // always concrete by the time a pencil can be clicked.
  const {
    view: messageVersionView,
    groups: messageVersionGroups,
    registerEditResend,
    selectVersion,
    revealLatestVersions,
  } = useMessageVersions({
    sessionId: selectedSession?.id ?? null,
    processingSessions,
  });

  // Persisted memory-updated indicator rows (ui12 phase 7).
  const { updates: memoryUpdates } = useMemoryUpdates({
    sessionId: selectedSession?.id ?? null,
    processingSessions,
  });

  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessages,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    requestLatestMessages,
  } = useChatSessionState({
    isActive,
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
    hideBootPrologue,
    bootTurnActive: bootState.phase === 'booting',
    messageVersions: messageVersionView,
    memoryUpdates,
  });
  const activeSessionKey = selectedSession?.id || currentSessionId || null;

  // Externally driven turns arrive through persisted-tail refreshes rather
  // than live provider frames. Infer their phase from only rows newer than
  // this run so the visible indicator and tool counter stay truthful too.
  useEffect(() => {
    if (!activeSessionKey || !sessionActivity) return;
    const phase = inferLivePhase(chatMessages, sessionActivity.startedAt);
    if (phase && phase !== sessionActivity.phase) {
      onSessionProcessing?.(activeSessionKey, { phase });
    }
  }, [activeSessionKey, chatMessages, onSessionProcessing, sessionActivity]);

  // Palette convenience: "Copy last response" copies the newest assistant
  // text of the open chat as plain text (same conversion as the copy button).
  const copyLastResponse = useCallback(() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      const message = chatMessages[i];
      if (message.type === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
        void copyTextToClipboard(convertMarkdownToPlainText(message.content));
        return;
      }
    }
  }, [chatMessages]);
  usePaletteOpsRegister(useMemo(() => (isActive ? { copyLastResponse } : {}), [isActive, copyLastResponse]));

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const {
    input,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
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
    openAttachmentPicker,
    handleSubmit,
    queuedDrafts,
    editQueuedDraft,
    deleteQueuedDraft,
    submitMessageEdit,
    clearUndoPending,
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
    commandModalPayload,
    closeCommandModal,
    runHandoff,
    retryBoot,
    markBootReady,
    markBootFailed,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    currentProviderModel,
    currentProviderEffort,
    currentProviderFastMode,
    isLoading: isProcessing,
    holdQueuedFlush,
    processingSessions,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
    newSessionTrigger,
    bootCommandName,
    sessionOrigin,
    bootState,
    setBootState,
    onEditResend: registerEditResend,
    onPlainSend: revealLatestVersions,
  });

  // ------------------------------------------------------------------
  // Silent boot lifecycle: the composer stays locked and the pane shows a
  // loading indicator from the New Session boot until the ready message posts.
  // `chatMessages` is already boot-filtered, so a visible assistant text means
  // the ready boundary is determined (the filter holds the in-flight turn back
  // until the run completes). An error during the attempt, or a turn that ends
  // without a ready message, flips to a retryable failure.
  // ------------------------------------------------------------------
  // Report the internally tracked session — set by the load/reset effects,
  // not derived from the selectedSession prop — so the pane header can catch
  // this surface holding a different session than the one it claims.
  useEffect(() => {
    onRenderedSessionChange?.(currentSessionId);
  }, [currentSessionId, onRenderedSessionChange]);

  const viewingBootSession =
    bootState.phase !== 'idle'
    && (bootState.sessionId ? bootState.sessionId === activeSessionKey : activeSessionKey === null);
  const isBootingView = viewingBootSession && bootState.phase === 'booting';

  const hasReadyAssistantText = useMemo(
    () =>
      chatMessages.some(
        (message) =>
          message.type === 'assistant'
          && !message.isToolUse
          && !message.isThinking
          && !message.isInteractivePrompt
          && Boolean(message.content?.trim()),
      ),
    [chatMessages],
  );
  // A reopened session whose persisted boot failed (aborted mid-boot, server
  // died) shows the failed-boot view instead of a plain empty chat. The local
  // machinery takes over the moment a retry engages, and any ready assistant
  // text means the chat became usable despite the stamp.
  const persistedBootFailedView =
    bootState.phase === 'idle'
    && selectedSession?.bootState === 'failed'
    && !hasReadyAssistantText;
  const bootFailedView = (viewingBootSession && bootState.phase === 'failed') || persistedBootFailedView;
  const errorMessageCount = useMemo(
    () => chatMessages.filter((message) => message.type === 'error').length,
    [chatMessages],
  );
  // Errors are counted against a per-attempt baseline so a retry in the same
  // session is not failed by the previous attempt's error still in view.
  const bootErrorBaselineRef = useRef({ attempt: bootState.attempt, errors: errorMessageCount });
  if (bootErrorBaselineRef.current.attempt !== bootState.attempt) {
    bootErrorBaselineRef.current = { attempt: bootState.attempt, errors: errorMessageCount };
  }
  const bootSawRunRef = useRef(false);
  useEffect(() => {
    if (!isBootingView) {
      bootSawRunRef.current = false;
      return;
    }
    if (hasReadyAssistantText) {
      bootSawRunRef.current = false;
      markBootReady();
      return;
    }
    if (errorMessageCount > bootErrorBaselineRef.current.errors) {
      bootSawRunRef.current = false;
      markBootFailed();
      return;
    }
    if (isProcessing) {
      bootSawRunRef.current = true;
      return;
    }
    // The boot turn ran and ended without a ready message: a dead boot.
    if (bootSawRunRef.current) {
      bootSawRunRef.current = false;
      markBootFailed();
    }
  }, [isBootingView, hasReadyAssistantText, errorMessageCount, isProcessing, markBootReady, markBootFailed]);

  // Handoff auto-flow (ui11 phase 3): when the server boots the next planner
  // session after this session's /handoff turn (button, typed, or rotation),
  // switch this pane to the new session and hold the boot loader until its
  // opening message arrives (the boot prologue stays hidden per the existing
  // rule). Only the pane viewing the outgoing session switches.
  useEffect(() => {
    if (!subscribe) {
      return;
    }
    return subscribe((event) => {
      const frame = event as { kind?: string; fromSessionId?: string; toSessionId?: string } | null;
      if (frame?.kind !== 'planner_handoff' || !frame.toSessionId) {
        return;
      }
      const viewedSessionId = selectedSession?.id ?? currentSessionId;
      if (!viewedSessionId || frame.fromSessionId !== viewedSessionId) {
        return;
      }
      const toSessionId = frame.toSessionId;
      bootedSessionsRef.current.add(toSessionId);
      setBootState((previous) => ({ phase: 'booting', sessionId: toSessionId, attempt: previous.attempt + 1 }));
      onNavigateToSession?.(toSessionId);
    });
  }, [subscribe, selectedSession?.id, currentSessionId, onNavigateToSession]);

  // On WebSocket reconnect, request a bounded persisted-tail sync (deferred
  // while Chat is hidden), then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await requestLatestMessages(selectedSession.id, isActive);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [isActive, requestLatestMessages, selectedProject, selectedSession, sendMessage]);

  useChatRealtimeHandlers({
    isActive,
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    sessionOrigin,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: handleWebSocketReconnect,
    requestLatestMessages,
    sessionStore,
  });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      // An open inline message editor owns Escape: it cancels the edit
      // instead of aborting the run.
      if ((event.target as HTMLElement | null)?.closest?.('[data-slot="message-edit"]')) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // A composer pick becomes the default for new chats (switching the composer
  // to that model's provider) and, when a session is open, is recorded against
  // that session so reopening it restores this model. A chat never changes
  // engine mid-conversation: a pick from the other provider's group while a
  // chat is open starts a new session on that engine instead.
  const handleSelectComposerModel = useCallback(async (targetProvider: LLMProvider, model: string) => {
    const openSessionId = currentSessionId || selectedSession?.id || null;
    try {
      if (openSessionId && targetProvider !== provider && onStartNewSession) {
        // Both in one synchronous batch: with the pane's session already
        // cleared when the provider flips, the session-provider sync effect
        // has nothing to snap the composer back to.
        onStartNewSession();
        await selectProviderModel(targetProvider, model, null);
        return;
      }
      await selectProviderModel(targetProvider, model, openSessionId);
    } catch (error) {
      console.error('Error changing the active session model:', error);
    }
  }, [currentSessionId, onStartNewSession, provider, selectProviderModel, selectedSession?.id]);

  // The switcher lists the two engines in use, each under its provider mark.
  const composerModelGroups = useMemo<ProviderModelGroup[]>(() => [
    { provider: 'claude', options: providerModelCatalog.claude?.OPTIONS ?? [] },
    { provider: 'codex', options: providerModelCatalog.codex?.OPTIONS ?? [] },
  ], [providerModelCatalog.claude, providerModelCatalog.codex]);

  const handleSelectComposerEffort = useCallback(async (effort: string) => {
    try {
      await selectProviderEffort(provider, effort, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session reasoning effort:', error);
    }
  }, [currentSessionId, provider, selectProviderEffort, selectedSession?.id]);

  const handleSelectComposerFastMode = useCallback(async (enabled: boolean) => {
    try {
      await selectCodexFastMode(enabled, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing fast mode for the active Codex session:', error);
    }
  }, [currentSessionId, selectCodexFastMode, selectedSession?.id]);

  // The inline thinking indicator hides while a permission request is pending
  // (the permission banner is the active status surface then).
  const paneActivity = pendingPermissionRequests.length === 0 ? sessionActivity : null;

  // The composer floats over the transcript (ui12 phase 3) so the scrollbar
  // track runs the full pane height. The transcript clears it with a trailing
  // spacer inside the scroller content sized by this measured height, so a
  // growing composer resizes the content and the follow-output engine re-pins.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const composerAreaRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const area = composerAreaRef.current;
    if (!pane || !area) return;

    const publish = () => {
      pane.style.setProperty('--composer-height', `${area.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(area);
    return () => observer.disconnect();
  }, [selectedProject]);

  // File-drop highlight (ui17 job 6): the pane owns the drag state through a
  // target tracker instead of react-dropzone's `isDragActive`, which the
  // overridden root ref left blind to its own children — every hop between
  // nested elements read as a leave and blinked the wash off. The tracker
  // stays active from the first dragenter until the last child is left, a
  // drop lands, or the drag ends anywhere on the page.
  const dragTrackerRef = useRef<PaneDragTracker | null>(null);
  if (!dragTrackerRef.current) {
    dragTrackerRef.current = createPaneDragTracker(
      (target) => target instanceof Node && !!paneRef.current && paneRef.current.contains(target),
    );
  }
  const [isFileOverPane, setIsFileOverPane] = useState(false);

  const handlePaneDragEnter = useCallback((event: React.DragEvent) => {
    if (!isFileDrag(event)) return;
    setIsFileOverPane(dragTrackerRef.current!.enter(event.target));
  }, []);

  const handlePaneDragLeave = useCallback((event: React.DragEvent) => {
    setIsFileOverPane(dragTrackerRef.current!.leave(event.target));
  }, []);

  const endPaneDrag = useCallback(() => {
    setIsFileOverPane(dragTrackerRef.current!.end());
  }, []);

  // A drag that ends off the pane (dropped on another surface, or cancelled)
  // never sends the pane a leave, so the page-level end clears the highlight.
  useEffect(() => {
    if (!isFileOverPane) return;
    window.addEventListener('dragend', endPaneDrag);
    window.addEventListener('drop', endPaneDrag);
    return () => {
      window.removeEventListener('dragend', endPaneDrag);
      window.removeEventListener('drop', endPaneDrag);
    };
  }, [isFileOverPane, endPaneDrag]);

  // Rerun action on assistant turns: resend the prompt that produced the turn
  // through the normal submit path, without touching the composer draft.
  const handleRerun = useCallback((content: string, event: React.MouseEvent) => {
    void handleSubmit(event, { id: createQueuedMessageId(), content, attachments: [], preserveComposer: true });
  }, [handleSubmit]);

  // Pencil on a user turn: turn that bubble into the inline transcript editor
  // (ui11 phase 13). One message edits at a time; opening another closes the
  // first, and switching sessions closes any open editor.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  useEffect(() => {
    setEditingMessageId(null);
  }, [selectedSession?.id]);

  const handleEditMessage = useCallback((message: ChatMessage) => {
    const messageId = typeof message.id === 'string' ? message.id : '';
    const content = typeof message.content === 'string' ? message.content : '';
    if (!messageId || !content.trim()) return;
    setEditingMessageId(messageId);
  }, []);

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  // Save from the inline editor: resend through edit-and-resend versioning.
  // An unchanged save is a no-op that just closes the editor. An
  // already-versioned turn keeps its group.
  const handleSaveEditMessage = useCallback((message: ChatMessage, content: string) => {
    setEditingMessageId(null);
    const messageId = typeof message.id === 'string' ? message.id : '';
    const original = typeof message.content === 'string' ? message.content : '';
    if (!messageId || !content.trim() || content.trim() === original.trim()) return;
    submitMessageEdit({
      groupId: findEditGroupId(messageVersionGroups, message),
      anchorUserMessageId: messageId,
      anchorPromptText: original,
    }, content);
  }, [submitMessageEdit, messageVersionGroups]);

  // getRootProps carries react-dropzone's own root ref; the pane needs the
  // same node for its composer measurements, so a callback ref feeds both.
  const { ref: dropzoneRootRef, ...paneRootProps } = getRootProps({
    onDragEnter: handlePaneDragEnter,
    onDragLeave: handlePaneDragLeave,
    onDrop: endPaneDrag,
  }) as React.HTMLAttributes<HTMLDivElement> & { ref?: React.MutableRefObject<HTMLDivElement | null> };

  const setPaneNode = useCallback((node: HTMLDivElement | null) => {
    paneRef.current = node;
    if (dropzoneRootRef) dropzoneRootRef.current = node;
  }, [dropzoneRootRef]);

  const selectedProviderLabel =
    provider === 'cursor'
      ? t('messageTypes.cursor')
      : provider === 'codex'
        ? t('messageTypes.codex')
        : provider === 'opencode'
            ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
          : t('messageTypes.claude');

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      {/* Inline transcript images resolve against this pane's project workspace. */}
      <ChatProjectContext.Provider value={selectedProject.projectId ?? null}>
      {/* The whole pane is the file-drop target (ui15 job 2): dropping
          anywhere on it attaches to this pane's composer. The pane node goes
          to both refs (ui17 job 6) so react-dropzone can still tell its own
          descendants apart while paneRef measures the composer. */}
      <div {...paneRootProps} ref={setPaneNode} data-slot="chat-pane" className="relative flex h-full min-h-0 flex-col">
        {isFileOverPane && (
          <div
            data-slot="pane-drop-highlight"
            className="overlay-enter pointer-events-none absolute inset-0 z-30 p-1"
            aria-hidden
          >
            <div className="flex h-full w-full items-end justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/[0.06] pb-24">
              <span className="rounded-md border border-border/40 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                {t('input.dropToAttach', { defaultValue: 'Drop to attach' })}
              </span>
            </div>
          </div>
        )}
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          isProcessing={isProcessing}
          isBootingSession={isBootingView}
          bootFailed={bootFailedView}
          onRetryBoot={retryBoot}
          activity={paneActivity}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          provider={provider}
          isLoadingMoreMessages={isLoadingMoreMessages}
          visibleMessages={visibleMessages}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          onRerun={handleRerun}
          onEditMessage={handleEditMessage}
          editingMessageId={editingMessageId}
          onSaveEditMessage={handleSaveEditMessage}
          onCancelEditMessage={handleCancelEditMessage}
          onSelectVersion={selectVersion}
        />

        <div ref={composerAreaRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
          {isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottomAndReset}
                aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          isLoading={isProcessing}
          isBootLocked={viewingBootSession}
          onAbortSession={handleAbortSession}
          effort={currentProviderEffort}
          fastMode={currentProviderFastMode}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={handleSelectComposerEffort}
          onSelectFastMode={handleSelectComposerFastMode}
          model={currentProviderModel}
          provider={provider}
          modelGroups={composerModelGroups}
          onSelectModel={handleSelectComposerModel}
          modelsLoading={providerModelsLoading}
          tokenBudget={tokenBudget}
          onToggleCommandMenu={handleToggleCommandMenu}
          onHandoff={runHandoff}
          handoffAvailable={selectedSession ? selectedSession.origin === 'planner' : sessionOrigin === 'planner'}
          onSubmit={handleSubmit}
          queuedDrafts={queuedDrafts}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          attachedFiles={attachedFiles}
          onRemoveAttachment={removeAttachedFile}
          onReplaceAttachmentText={replaceAttachedFileText}
          draftAttachments={draftAttachments}
          onRemoveDraftAttachment={removeDraftAttachment}
          onReplaceDraftAttachmentText={replaceDraftAttachmentText}
          uploadingFiles={uploadingFiles}
          fileErrors={fileErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onVoiceTranscript={handleVoiceTranscript}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder="Write a message..."
          isTextareaExpanded={isTextareaExpanded}
          clearUndoPending={clearUndoPending}
          onClearComposer={clearComposer}
          onUndoClear={undoClearComposer}
          historyProjectId={selectedProject.projectId ?? null}
          historySessionId={activeSessionKey}
          onUsePrompt={loadPromptIntoComposer}
        />
        </div>
      </div>

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelActions={providerModelActions}
        activeProvider={provider}
        activeProviderModel={currentProviderModel}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />
      </ChatProjectContext.Provider>
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
