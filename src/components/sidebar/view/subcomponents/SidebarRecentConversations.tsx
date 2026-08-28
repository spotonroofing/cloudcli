import { MessageSquare, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Skeleton } from '../../../../shared/view/ui';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { RecentConversationListItem } from '../../types/types';
import { formatCompactAge } from '../../utils/utils';

import ChatRow from './ChatRow';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

type SidebarRecentConversationsProps = {
  conversations: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** Move-to-project targets for the shared row menu's drawer. */
  projects: Project[];
  responseIndicators: ReadonlyMap<string, { kind: 'planner' | 'worker'; projectId: string | null }>;
  onSessionViewed: (sessionId: string) => void;
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onRenameConversation: (sessionId: string, name: string) => void;
  onMoveConversationToProject: (sessionId: string, projectPath: string | null) => void;
  onArchiveConversation: (sessionId: string) => void;
  onDeleteConversation: (
    projectId: string | null,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onNewStandaloneChat: () => void;
  t: TFunction;
};

function RecentConversationSkeleton() {
  return (
    <div className="space-y-1 px-1" data-slot="recent-conversations-skeleton" aria-label="Loading recent conversations" aria-busy="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 rounded-sm" style={{ width: `${72 - index * 3}%` }} />
            <Skeleton className="h-2.5 w-1/2 rounded-sm" />
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
  projects,
  responseIndicators,
  onSessionViewed,
  onConversationSelect,
  onLoadMore,
  onRetry,
  onRenameConversation,
  onMoveConversationToProject,
  onArchiveConversation,
  onDeleteConversation,
  onNewStandaloneChat,
  t,
}: SidebarRecentConversationsProps) {
  if (isLoading && conversations.length === 0) {
    return <RecentConversationSkeleton />;
  }

  if (hasError && conversations.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
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
      <div className="px-4 py-12 text-center md:py-8">
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

      <div className="relative space-y-1">
        {conversations.map((conversation) => {
          const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
          const age = formatCompactAge(conversation.lastActivity, currentTime);
          const provider = (conversation.provider || 'claude') as LLMProvider;

          return (
            <ChatRow
              key={conversation.sessionId}
              href={`/session/${conversation.sessionId}`}
              dataTestId="recent-conversation-row"
              title={conversation.sessionTitle}
              subtitle={conversation.projectDisplayName ?? t('standalone.noProject', 'No project')}
              subtitleItalic={!conversation.projectDisplayName}
              timestamp={conversation.lastActivity}
              age={age}
              isSelected={isSelected}
              responseKinds={{
                planner: responseIndicators.get(conversation.sessionId)?.kind === 'planner',
                worker: responseIndicators.get(conversation.sessionId)?.kind === 'worker',
              }}
              onSelect={() => {
                onSessionViewed(conversation.sessionId);
                onConversationSelect(
                  conversation.projectId,
                  conversation.sessionId,
                  conversation.provider,
                );
              }}
              onRename={(name) => onRenameConversation(conversation.sessionId, name)}
              menu={{
                sessionId: conversation.sessionId,
                sessionTitle: conversation.sessionTitle,
                providerLabel: PROVIDER_LABELS[provider] ?? 'Claude',
                projects,
                currentProjectId: conversation.projectId,
                currentProjectName: conversation.projectDisplayName,
                onMoveToProject: (projectPath) => onMoveConversationToProject(conversation.sessionId, projectPath),
                onArchive: () => onArchiveConversation(conversation.sessionId),
                onDelete: () => onDeleteConversation(
                  conversation.projectId,
                  conversation.sessionId,
                  conversation.sessionTitle,
                  provider,
                ),
              }}
            />
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
