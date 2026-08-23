import { ChevronRight, FolderInput, MessageSquare, Plus } from 'lucide-react';
import { useRef } from 'react';
import type { MouseEvent } from 'react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { BounceIndicator } from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import type { ProjectSession } from '../../../../types/app';
import type { RecentConversationListItem } from '../../types/types';
import { formatCompactAge } from '../../utils/utils';

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onMoveConversation: (sessionId: string, sessionTitle: string) => void;
  onNewStandaloneChat: () => void;
  t: TFunction;
};

function RecentConversationSkeleton() {
  return (
    <div className="space-y-1 px-1" aria-label="Loading recent conversations">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${72 - index * 3}%` }} />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SidebarRecentConversations({
  conversations,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  hasError,
  selectedSession,
  currentTime,
  onConversationSelect,
  onLoadMore,
  onRetry,
  onMoveConversation,
  onNewStandaloneChat,
  t,
}: SidebarRecentConversationsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  if (isLoading && conversations.length === 0) {
    return <RecentConversationSkeleton />;
  }

  if (hasError && conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <MessageSquare className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('recent.emptyTitle', 'No conversations yet')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('recent.emptyDescription', 'Your most recently updated conversations will appear here.')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onNewStandaloneChat}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('recent.newChat', 'New chat')}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-1" data-testid="recent-conversations-list">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('recent.title', 'Recent conversations')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground/70">{total}</span>
          <button
            type="button"
            className="touch-hit relative flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            title={t('recent.newChat', 'New chat')}
            aria-label={t('recent.newChat', 'New chat')}
            onClick={onNewStandaloneChat}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div ref={listRef} className="relative space-y-1">
        {/* Same law as the project list: the bounce dot is the one honest
            indicator of the open chat. */}
        <BounceIndicator
          activeKey={selectedSession ? String(selectedSession.id) : null}
          containerRef={listRef}
        />
        {conversations.map((conversation) => {
          const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
          const age = formatCompactAge(conversation.lastActivity, currentTime);

          const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            onConversationSelect(
              conversation.projectId,
              conversation.sessionId,
              conversation.provider,
            );
          };

          return (
            <a
              key={conversation.sessionId}
              href={`/session/${conversation.sessionId}`}
              onClick={handleClick}
              data-testid="recent-conversation-row"
              data-bounce-key={conversation.sessionId}
              className={cn(
                'group relative flex min-w-0 items-center gap-2 rounded-lg py-2 pl-4 pr-3 text-left transition-colors',
                isSelected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-normal leading-4">
                  {conversation.sessionTitle}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
                  <span className={cn('truncate', !conversation.projectDisplayName && 'italic text-muted-foreground/70')}>
                    {conversation.projectDisplayName ?? t('standalone.noProject', 'No project')}
                  </span>
                  {age && (
                    <>
                      <span className="flex-shrink-0 text-muted-foreground/40">·</span>
                      <time className="flex-shrink-0 tabular-nums" dateTime={conversation.lastActivity ?? undefined}>
                        {age}
                      </time>
                    </>
                  )}
                </span>
              </span>

              <button
                type="button"
                className="touch-hit relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground md:hidden md:group-hover:flex"
                title={t('moveSession.title', 'Move chat to project')}
                aria-label={t('moveSession.title', 'Move chat to project')}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onMoveConversation(conversation.sessionId, conversation.sessionTitle);
                }}
              >
                <FolderInput className="h-3.5 w-3.5" />
              </button>
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
            </a>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-11 w-full text-xs text-muted-foreground md:h-8"
          onClick={onLoadMore}
          disabled={isLoadingMore}
        >
          {isLoadingMore
            ? t('recent.loadingMore', 'Loading more...')
            : t('recent.loadMore', 'Load older conversations')}
        </Button>
      )}
    </div>
  );
}
