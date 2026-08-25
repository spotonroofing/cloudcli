import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { EASE_OUT } from '../../../../shared/view/beui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  /** Move-to-project targets for the shared row menu's drawer. */
  projects: Project[];
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  currentTime: Date;
  onMoveSessionToProject: (sessionId: string, projectPath: string | null) => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  projects,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  attentionSessionIds,
  currentTime,
  onMoveSessionToProject,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  const hasSessions = sessions.length > 0;

  // beUI ai-sidebar reveal: the session block unfolds and folds with the same
  // eased height/opacity motion in both directions; indent is depth padding,
  // not a tree rule.
  return (
    <AnimatePresence initial={false}>
      {isExpanded && (
        <motion.div
          key="sessions"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          <div className="space-y-1 py-1.5 pl-5">
      {/* One new-session control on both form factors; mobile gets a taller
          touch target. handleNewSession selects the project itself. */}
      <Button
        variant="default"
        size="sm"
        className="mb-1.5 h-11 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:h-8"
        onClick={() => onNewSession(project)}
      >
        <Plus className="h-3 w-3" />
        {t('sessions.newSession')}
      </Button>

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {sessions.map((session) => (
            <SidebarSessionItem
              key={session.id}
              project={project}
              projects={projects}
              session={session}
              selectedSession={selectedSession}
              isProcessing={activeSessions.has(session.id)}
              needsAttention={attentionSessionIds.has(session.id)}
              currentTime={currentTime}
              onMoveSessionToProject={onMoveSessionToProject}
              onSaveEditingSession={onSaveEditingSession}
              onProjectSelect={onProjectSelect}
              onSessionSelect={onSessionSelect}
              onArchiveSession={onArchiveSession}
              onDeleteSession={onDeleteSession}
              t={t}
            />
          ))}

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full justify-center text-xs text-muted-foreground hover:text-foreground md:h-8"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
