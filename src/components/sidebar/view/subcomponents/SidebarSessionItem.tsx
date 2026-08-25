import type { TFunction } from 'i18next';

import { Tooltip } from '../../../../shared/view/ui';
import { BorderBeamOverlay, useBeamPresence } from '../../../../shared/view/beui';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel, formatCompactAge } from '../../utils/utils';

import ChatRow from './ChatRow';

type SidebarSessionItemProps = {
  project: Project;
  /** Move-to-project targets for the shared row menu's drawer. */
  projects: Project[];
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
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
  t: TFunction;
};

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export default function SidebarSessionItem({
  project,
  projects,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  currentTime,
  onMoveSessionToProject,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const compactSessionAge = formatCompactAge(sessionView.sessionTime, currentTime);
  const showAttentionIndicator = needsAttention && !isSelected;
  const providerLabel = PROVIDER_LABELS[session.__provider];
  // Activity shimmer: a mid-turn chat row carries the border beam (it replaced
  // the old green pulse dot); appearance and disappearance are engine fades.
  const beam = useBeamPresence(isProcessing);

  const selectSession = () => {
    // Mobile needs the project selected too (chat-view context + sidebar
    // collapse), matching the Chats tab's select flow; desktop keeps the
    // session-only selection so the docked project route stays put.
    if (window.innerWidth < 768) {
      onProjectSelect(project);
    }
    onSessionSelect(session, project.projectId);
  };

  return (
    <div className="relative">
      {showAttentionIndicator && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip
            content={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })}
            position="right"
          >
            <div
              role="status"
              aria-label={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })}
              className="h-2 w-2 animate-pulse rounded-full bg-amber-500"
            />
          </Tooltip>
        </div>
      )}

      {/* Unified chat-row anatomy (ui9 B5): the exact same ChatRow as the
          Chats tab at every viewport — title over relative time bottom-left,
          arrow-to-dots trailing control, one shared menu. */}
      <ChatRow
        href={`/session/${session.id}`}
        bounceKey={String(session.id)}
        title={sessionView.sessionName}
        timestamp={sessionView.sessionTime || null}
        age={compactSessionAge}
        isSelected={isSelected}
        onSelect={selectSession}
        overlay={beam.mounted ? <BorderBeamOverlay {...beam.beamProps} /> : null}
        onRename={(name) => onSaveEditingSession(project.projectId, session.id, name, session.__provider)}
        menu={{
          sessionId: session.id,
          sessionTitle: sessionView.sessionName,
          providerLabel,
          projects,
          currentProjectId: project.projectId,
          currentProjectName: project.displayName,
          onMoveToProject: (projectPath) => onMoveSessionToProject(session.id, projectPath),
          onArchive: () => onArchiveSession(session.id),
          onDelete: () => onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider),
          isProcessing,
        }}
      />
    </div>
  );
}
