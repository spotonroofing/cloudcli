import { useTranslation } from 'react-i18next';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import type { ChatMessage } from '../../types/types';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '../../utils/toolGrouping';
import { Button } from '../../../../shared/view/ui';
import { MessageScroller } from '../../../../shared/view/beui';
import { Loader } from '../../../../shared/view/beui/Loader';

import ActivityIndicator from './ActivityIndicator';
import MessageComponent from './MessageComponent';
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

            return groupedVisibleMessages.map((item) => {
              if (isToolGroupItem(item)) {
                const groupPrevMessage = prevMessage;
                prevMessage = item.messages[item.messages.length - 1] || prevMessage;

                return (
                  <ToolGroupContainer
                    key={`tool-group-${getMessageKey(item.messages[0])}`}
                    group={item}
                    animateFrom={animateFrom}
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
                );
              }

              const messagePrevMessage = prevMessage;
              prevMessage = item;

              return (
                <MessageComponent
                  key={getMessageKey(item)}
                  message={item}
                  animateFrom={animateFrom}
                  prevMessage={messagePrevMessage}
                  createDiff={createDiff}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  onGrantToolPermission={onGrantToolPermission}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  selectedProject={selectedProject}
                  provider={provider}
                />
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
