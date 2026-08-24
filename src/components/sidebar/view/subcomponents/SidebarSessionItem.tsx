import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Copy, Edit2, FolderInput, Loader2, MoreHorizontal, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Dialog, DialogContent, DialogTitle, Tooltip } from '../../../../shared/view/ui';
import { BorderBeamOverlay, useBeamPresence } from '../../../../shared/view/beui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel, formatCompactAge } from '../../utils/utils';
import LLMProviderLogo from '../../../llm-provider-logo/LLMProviderLogo';

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
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onMoveSessionToProject: (sessionId: string, projectPath: string | null) => void;
  onCancelEditingSession: () => void;
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

type CopyState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';
export default function SidebarSessionItem({
  project,
  projects,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onMoveSessionToProject,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onArchiveSession,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const compactSessionAge = formatCompactAge(sessionView.sessionTime, currentTime);
  const [isMobileOptionsOpen, setIsMobileOptionsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const providerIdRequestRef = useRef(0);
  const showAttentionIndicator = needsAttention && !isSelected;
  const providerLabel = PROVIDER_LABELS[session.__provider];
  // Activity shimmer: a mid-turn chat row carries the border beam (it replaced
  // the old green pulse dot); appearance and disappearance are engine fades.
  const beam = useBeamPresence(isProcessing);

  // The mobile sheet's rename lives inside the bottom sheet, which owns its
  // own dismissal; closing the sheet cancels an in-flight rename.
  useEffect(() => {
    if (!isMobileOptionsOpen && isEditing) {
      onCancelEditingSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileOptionsOpen]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  const loadProviderSessionId = async () => {
    const requestId = ++providerIdRequestRef.current;
    setCopyState('loading');
    try {
      const response = await api.providerSessionId(session.id);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }

      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(loadedSessionId);
      setCopyState('idle');
    } catch {
      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(null);
      setCopyState('error');
    }
  };

  const resetCopyState = () => {
    providerIdRequestRef.current += 1;
    setCopyState('idle');
    setProviderSessionId(null);
  };

  const setMobileOptionsOpen = (open: boolean) => {
    setIsMobileOptionsOpen(open);
    if (open) {
      setProviderSessionId(null);
      void loadProviderSessionId();
    } else {
      resetCopyState();
    }
  };

  const startMobileRename = () => {
    onStartEditingSession(session.id, sessionView.sessionName);
  };

  const saveMobileRename = () => {
    saveEditedSession();
    setMobileOptionsOpen(false);
  };

  const copyProviderSessionId = async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  };

  const handleCopyAction = () => {
    if (copyState === 'error' && !providerSessionId) {
      void loadProviderSessionId();
    } else {
      void copyProviderSessionId();
    }
  };

  const isCopyPending = copyState === 'loading' || copyState === 'copying';
  const CopyStateIcon = copyState === 'copied' ? Check : Copy;
  const copyLabel = copyState === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : `Copy ${providerLabel} session ID`;

  return (
    <div className="group relative">
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

      <div className="md:hidden">
        {/* Mobile session row: the unified chat-row anatomy (title over
            relative time bottom-left) with touch adaptations — taller row and
            an always-visible options button with a 44px hit area opening the
            bottom sheet. */}
        <div
          role="button"
          tabIndex={0}
          title={sessionView.sessionName}
          data-bounce-key={session.id}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectMobileSession();
            }
          }}
          className={cn(
            'relative flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg py-2 pl-4 pr-3 text-left outline-none',
            'text-muted-foreground transition-colors active:text-foreground',
            isSelected && 'text-foreground',
          )}
          onClick={selectMobileSession}
        >
          {beam.mounted && <BorderBeamOverlay {...beam.beamProps} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-normal leading-4">{sessionView.sessionName}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
              {isProcessing ? (
                <Loader2 className="h-2.5 w-2.5 flex-shrink-0 animate-spin" />
              ) : compactSessionAge && (
                <time className="flex-shrink-0 tabular-nums" dateTime={sessionView.sessionTime || undefined}>
                  {compactSessionAge}
                </time>
              )}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Session options for ${sessionView.sessionName}`}
            aria-haspopup="dialog"
            aria-expanded={isMobileOptionsOpen}
            className="touch-hit relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted"
            onClick={(event) => {
              event.stopPropagation();
              setMobileOptionsOpen(true);
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <Dialog open={isMobileOptionsOpen} onOpenChange={setMobileOptionsOpen}>
          <DialogContent
            aria-describedby="mobile-session-options-description"
            wrapperClassName="md:hidden"
            animationClassName="animate-bottom-sheet-content-show motion-reduce:animate-none"
            className="bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-lg border-x-0 border-b-0 px-4 pb-safe-area-inset-bottom pt-3"
          >
            <DialogTitle>Session options</DialogTitle>
            <div className="mx-auto mb-4 h-1 w-10 rounded-sm bg-muted-foreground/30" aria-hidden="true" />

            <div className="mb-4 flex items-center gap-3 px-1">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                <LLMProviderLogo provider={session.__provider} className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={sessionView.sessionName}>
                  {sessionView.sessionName}
                </p>
                <p id="mobile-session-options-description" className="text-xs text-muted-foreground">
                  {providerLabel} session
                </p>
              </div>
            </div>

            {isEditing ? (
              <div className="mb-3 space-y-2">
                <label htmlFor={`mobile-session-rename-${session.id}`} className="block px-1 text-xs font-medium text-muted-foreground">
                  Session name
                </label>
                <input
                  id={`mobile-session-rename-${session.id}`}
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveMobileRename();
                    }
                  }}
                  className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-3 text-foreground shadow-sm focus:border-primary focus:outline-none"
                  autoFocus
                  autoComplete="off"
                  // 16px keeps iOS Safari from zooming the viewport on focus.
                  style={{ fontSize: '16px' }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveMobileRename}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
                  >
                    <Check className="h-5 w-5 flex-shrink-0" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEditingSession}
                    className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-muted/35 px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-muted"
                  >
                    <X className="h-5 w-5 flex-shrink-0" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={startMobileRename}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                >
                  <Edit2 className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Rename session</span>
                </button>

                <MobileMoveToProject
                  projects={projects}
                  currentProjectId={project.projectId}
                  currentProjectName={project.displayName}
                  onMove={(projectPath) => {
                    setMobileOptionsOpen(false);
                    onMoveSessionToProject(session.id, projectPath);
                  }}
                />

                <button
                  type="button"
                  onClick={handleCopyAction}
                  disabled={isCopyPending}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                    copyState === 'copied'
                      ? 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : copyState === 'error'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : 'border-border bg-muted/35 text-foreground active:bg-muted',
                  )}
                >
                  {isCopyPending ? (
                    <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
                  ) : (
                    <CopyStateIcon className="h-5 w-5 flex-shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{copyLabel}</span>
                    {copyState === 'error' && (
                      <span className="mt-0.5 block text-xs">Tap to try again.</span>
                    )}
                  </span>
                </button>

                {!isProcessing && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileOptionsOpen(false);
                        onArchiveSession(session.id);
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
                    >
                      <Archive className="h-5 w-5 flex-shrink-0" />
                      <span className="text-sm font-medium">Archive chat</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileOptionsOpen(false);
                        requestDeleteSession();
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-destructive transition-colors active:bg-destructive/10"
                    >
                      <Trash2 className="h-5 w-5 flex-shrink-0" />
                      <span className="text-sm font-medium">Delete chat</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {!isEditing && (
              <button
                type="button"
                onClick={() => setMobileOptionsOpen(false)}
                className="mb-3 mt-2 min-h-11 w-full rounded-lg text-sm font-medium text-muted-foreground transition-colors active:bg-muted"
              >
                Cancel
              </button>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="hidden md:block">
        {/* Unified chat-row anatomy (ui9 B5): identical to the Chats tab —
            title over relative time bottom-left, arrow-to-dots trailing
            control, one shared menu. */}
        <ChatRow
          href={`/session/${session.id}`}
          bounceKey={String(session.id)}
          title={sessionView.sessionName}
          timestamp={sessionView.sessionTime || null}
          age={compactSessionAge}
          isSelected={isSelected}
          onSelect={() => onSessionSelect(session, project.projectId)}
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
            onDelete: requestDeleteSession,
            isProcessing,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Mobile counterpart of the desktop move drawer: the same project list,
 * expanding downward inside the bottom sheet, with "Remove from <project>"
 * standing in for the standalone option when the chat lives in a project.
 */
function MobileMoveToProject({
  projects,
  currentProjectId,
  currentProjectName,
  onMove,
}: {
  projects: Project[];
  currentProjectId: string | null;
  currentProjectName: string | null;
  onMove: (projectPath: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/35">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
      >
        <FolderInput className="h-5 w-5 flex-shrink-0" />
        <span className="text-sm font-medium">Move to project</span>
      </button>
      {expanded && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto border-t border-border/60 p-1.5">
          {currentProjectId ? (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors active:bg-muted"
              onClick={() => onMove(null)}
            >
              <X className="h-4 w-4 flex-shrink-0" />
              Remove from {currentProjectName ?? 'project'}
            </button>
          ) : null}
          {projects
            .filter((candidate) => candidate.projectId !== currentProjectId)
            .map((candidate) => (
              <button
                key={candidate.projectId}
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors active:bg-muted"
                onClick={() => onMove(candidate.fullPath || candidate.path || '')}
              >
                <span className="truncate">{candidate.displayName || candidate.projectId}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
