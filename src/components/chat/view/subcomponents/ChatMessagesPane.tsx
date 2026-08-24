import { useTranslation } from 'react-i18next';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';

import type { ChatMessage } from '../../types/types';
import type { MessageVersionNav } from '../../utils/messageVersions';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '../../utils/toolGrouping';
import { Button } from '../../../../shared/view/ui';
import { MessageScroller } from '../../../../shared/view/beui';
import { Loader } from '../../../../shared/view/beui/Loader';

import ActivityIndicator from './ActivityIndicator';
import MessageComponent from './MessageComponent';
import MessageVersionNavigator from './MessageVersionNavigator';
import ToolGroupContainer from './ToolGroupContainer';
import LoadAllMessagesOverlay from './LoadAllMessagesOverlay';
import ChatExportMenu from './ChatExportMenu';

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** True while a New Session boot is in flight (boot prologue hidden, composer locked). */
  isBootingSession?: boolean;
  /** True when the boot turn errored or ended without a ready message. */
  bootFailed?: boolean;
  onRetryBoot?: () => void;
  /** The viewed session's in-flight activity; drives the inline thinking indicator. */
  activity?: SessionActivity | null;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  provider: LLMProvider;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  /** Sends a prior user prompt again (the rerun action on assistant turns). */
  onRerun?: (content: string, event: ReactMouseEvent) => void;
  /** Pencil on user turns: loads the text into the composer for a silent resend. */
  onEditMessage?: (message: ChatMessage) => void;
  /** Flips the visible response version of an edited exchange. */
  onSelectVersion?: (groupId: string, version: number) => void;
}

function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  isBootingSession = false,
  bootFailed = false,
  onRetryBoot,
  activity = null,
  chatMessages,
  selectedSession,
  provider,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  onRerun,
  onEditMessage,
  onSelectVersion,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );

  // Live-edge epoch for enter animations (beUI Message pattern): only rows
  // that arrive after this pane last switched sessions pop up; loaded history
  // renders statically, so a session open never replays a cascade.
  const sessionKey = selectedSession?.id ?? null;
  const animateEpochRef = useRef<{ key: string | null; at: number }>({ key: sessionKey, at: Date.now() });
  if (animateEpochRef.current.key !== sessionKey) {
    animateEpochRef.current = { key: sessionKey, at: Date.now() };
  }
  const animateFrom = animateEpochRef.current.at;

  // Replay guard: a message whose content this pane has already shown must not
  // pop in again. Mid-turn the same logical row remounts under a new React key
  // (optimistic user echo swapped for the server echo, streamed text swapped
  // for the transcript row), which resets MessageComponent's per-mount latch —
  // so the guard tracks what was rendered, not what was mounted. Signatures
  // count occurrences so a genuinely new duplicate (same text sent twice)
  // still animates.
  // Length + prefix, not full text: streamed turns record one signature per
  // reveal commit, so full-text keys would grow the registry by the whole
  // message per frame. Same type + length + first 200 chars only collides on
  // effectively identical messages, which occurrence counting already handles.
  const messageSignature = (message: ChatMessage): string => {
    if (message.toolId) return `${message.type}:tool:${message.toolId}`;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    return `${message.type}:${message.isThinking ? 'think' : 'text'}:${content.length}:${content.slice(0, 200)}`;
  };
  const seenSignaturesRef = useRef<{ key: string | null; counts: Map<string, number> }>({
    key: sessionKey,
    counts: new Map(),
  });
  if (seenSignaturesRef.current.key !== sessionKey) {
    seenSignaturesRef.current = { key: sessionKey, counts: new Map() };
  }
  const alreadySeenMap = useMemo(() => {
    const seen = seenSignaturesRef.current.counts;
    const occurrences = new Map<string, number>();
    const map = new WeakMap<ChatMessage, boolean>();
    const visit = (message: ChatMessage) => {
      const signature = messageSignature(message);
      const index = occurrences.get(signature) ?? 0;
      occurrences.set(signature, index + 1);
      map.set(message, index < (seen.get(signature) ?? 0));
    };
    for (const item of groupedVisibleMessages) {
      if (isToolGroupItem(item)) {
        item.messages.forEach(visit);
      } else {
        visit(item);
      }
    }
    return map;
  }, [groupedVisibleMessages]);
  useEffect(() => {
    const seen = seenSignaturesRef.current.counts;
    const occurrences = new Map<string, number>();
    const record = (message: ChatMessage) => {
      const signature = messageSignature(message);
      occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1);
    };
    for (const item of groupedVisibleMessages) {
      if (isToolGroupItem(item)) {
        item.messages.forEach(record);
      } else {
        record(item);
      }
    }
    for (const [signature, count] of occurrences) {
      if (count > (seen.get(signature) ?? 0)) seen.set(signature, count);
    }
    // Streaming partials add an entry per reveal commit; cap the registry so a
    // marathon session stays bounded. Evicted entries are ancient rows whose
    // remount-replay risk is nil (remounts happen at the live edge).
    while (seen.size > 4000) {
      seen.delete(seen.keys().next().value as string);
    }
  }, [groupedVisibleMessages]);
  // A seen row gets epoch 0: both row components treat a falsy epoch as "render statically".
  const epochFor = (message: ChatMessage) => (alreadySeenMap.get(message) ? 0 : animateFrom);

  // Stable, deterministic keys for the messages rendered this pass.
  //
  // `normalizedToChatMessages` rebuilds fresh ChatMessage objects on every store
  // update, so caching keys by object identity (or via a cross-render allocation
  // Set) minted a brand-new key for the *same* logical message on each prepend —
  // remounting the whole list, which disconnects the scroll-restore anchor and
  // reflows heights, jumping the viewport to the bottom. Deriving keys purely
  // from this render's ordered messages (intrinsic key, disambiguated by
  // occurrence index on collision) yields the same key for the same message
  // order, so React preserves existing DOM nodes and component state on prepend.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    for (const item of groupedVisibleMessages) {
      if (isToolGroupItem(item)) {
        item.messages.forEach(assign);
      } else {
        assign(item);
      }
    }
    return keys;
  }, [groupedVisibleMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );

  return (
    <MessageScroller
      className="relative min-h-0 flex-1"
      viewportRef={scrollContainerRef as unknown as RefObject<HTMLElement>}
      viewportClassName="chat-messages-pane overflow-x-hidden pb-3 pt-3 sm:pb-4 sm:pt-4"
      viewportProps={{ onWheel, onTouchMove }}
      busy={isProcessing}
      label={t('session.transcriptLabel', { defaultValue: 'Conversation' })}
    >
      {chatMessages.length > 0 && (
        <div className="pointer-events-none sticky right-4 top-3 z-10 mb-2 flex justify-end sm:px-4">
          <div className="pointer-events-auto">
            <ChatExportMenu messages={chatMessages} sessionTitle={selectedSession?.title} />
          </div>
        </div>
      )}
      <div className="mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4">
      {bootFailed && chatMessages.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t('session.boot.failed', { defaultValue: 'The session failed to start.' })}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetryBoot}>
            {t('session.boot.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      ) : (isLoadingSessionMessages || isProcessing || isBootingSession) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-center space-x-2">
            <Loader variant="dot-matrix" size={16} className="shrink-0 text-muted-foreground" />
            <p>
              {isBootingSession
                ? t('session.boot.starting', { defaultValue: 'Starting session...' })
                : t('session.loading.sessionMessages')}
            </p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? null : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <Loader variant="dot-matrix" size={16} className="shrink-0 text-muted-foreground" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-primary underline hover:text-primary/80" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-primary underline hover:text-primary/80"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {(() => {
            let prevMessage: ChatMessage | null = null;
            // The most recent user prompt seen while walking the transcript in
            // order — the content an assistant row's rerun action resends.
            let lastUserContent: string | null = null;

            return groupedVisibleMessages.map((item) => {
              if (isToolGroupItem(item)) {
                const groupPrevMessage = prevMessage;
                prevMessage = item.messages[item.messages.length - 1] || prevMessage;
                const groupNav = onSelectVersion
                  ? (item.messages.find((member) => member.versionNav)?.versionNav as MessageVersionNav | undefined)
                  : undefined;

                return (
                  <Fragment key={`tool-group-${getMessageKey(item.messages[0])}`}>
                    <ToolGroupContainer
                      group={item}
                      animateFrom={epochFor(item.messages[0])}
                      prevMessage={groupPrevMessage}
                      createDiff={createDiff}
                      getMessageKey={getMessageKey}
                      onFileOpen={onFileOpen}
                      onShowSettings={onShowSettings}
                      onGrantToolPermission={onGrantToolPermission}
                      showRawParameters={showRawParameters}
                      showThinking={showThinking}
                      selectedProject={selectedProject}
                      provider={provider}
                    />
                    {groupNav && onSelectVersion && (
                      <MessageVersionNavigator nav={groupNav} onSelect={onSelectVersion} />
                    )}
                  </Fragment>
                );
              }

              const messagePrevMessage = prevMessage;
              prevMessage = item;
              const rerunContent = item.type === 'assistant' ? lastUserContent : null;
              if (item.type === 'user' && typeof item.content === 'string' && item.content.trim()) {
                lastUserContent = item.content;
              }

              const messageNav = onSelectVersion
                ? (item.versionNav as MessageVersionNav | undefined)
                : undefined;

              return (
                <Fragment key={getMessageKey(item)}>
                  <MessageComponent
                    message={item}
                    animateFrom={epochFor(item)}
                    prevMessage={messagePrevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    onGrantToolPermission={onGrantToolPermission}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                    rerunContent={rerunContent ?? undefined}
                    onRerun={onRerun}
                    onEditMessage={onEditMessage}
                  />
                  {messageNav && onSelectVersion && (
                    <MessageVersionNavigator
                      nav={messageNav}
                      onSelect={onSelectVersion}
                      align={item.type === 'user' ? 'end' : 'start'}
                    />
                  )}
                </Fragment>
              );
            });
          })()}

          <ActivityIndicator activity={activity} />

          {bootFailed && (
            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground">
                {t('session.boot.failed', { defaultValue: 'The session failed to start.' })}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetryBoot}>
                {t('session.boot.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          )}
        </>
      )}
      </div>
    </MessageScroller>
  );
}

export default memo(ChatMessagesPane);
