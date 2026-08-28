import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { Loader2, ArrowUpIcon, FileTextIcon, History, XIcon } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { ChatAttachment, PendingPermissionRequest } from '../../types/types';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';
import type { ProviderModelGroup } from './ComposerModelMenu';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ComposerAttachment from './ComposerAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessageCard from './QueuedMessageCard';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerPlusMenu from './ComposerPlusMenu';
import PromptHistoryPanel from './PromptHistoryPanel';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/** How long a removed queued card ramps closed before unmounting. */
const QUEUED_CARD_COLLAPSE_MS = 250;

/**
 * Renders the live queued drafts plus recently removed ones held briefly in a
 * leaving state, so a cleared card collapses on the ramp instead of blinking
 * out (ui15 job 2).
 */
function useCollapsingQueuedCards(queuedDrafts: QueuedDraft[]) {
  const [entries, setEntries] = useState<Array<{ draft: QueuedDraft; leaving: boolean }>>(
    () => queuedDrafts.map((draft) => ({ draft, leaving: false })),
  );

  useEffect(() => {
    setEntries((previous) => {
      const kept = previous.map((entry) => {
        const live = queuedDrafts.find((draft) => draft.id === entry.draft.id);
        return live ? { draft: live, leaving: false } : { ...entry, leaving: true };
      });
      const knownIds = new Set(kept.map((entry) => entry.draft.id));
      const added = queuedDrafts
        .filter((draft) => !knownIds.has(draft.id))
        .map((draft) => ({ draft, leaving: false }));
      return [...kept, ...added];
    });
  }, [queuedDrafts]);

  const hasLeaving = entries.some((entry) => entry.leaving);
  useEffect(() => {
    if (!hasLeaving) {
      return;
    }
    const timer = setTimeout(() => {
      setEntries((previous) => previous.filter((entry) => !entry.leaving));
    }, QUEUED_CARD_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [hasLeaving, entries.length]);

  return entries;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  isLoading: boolean;
  /** True while a New Session boot is in flight or failed: typing is locked until the ready message posts. */
  isBootLocked?: boolean;
  onAbortSession: () => void;
  effort: string;
  fastMode: boolean;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  onSelectFastMode: (enabled: boolean) => void;
  model: string;
  provider: LLMProvider;
  /** The Claude and OpenAI catalogs the switcher lists, each under its provider mark. */
  modelGroups: ProviderModelGroup[];
  onSelectModel: (provider: LLMProvider, model: string) => void;
  modelsLoading: boolean;
  tokenBudget: Record<string, unknown> | null;
  onToggleCommandMenu: () => void;
  onHandoff: () => void;
  /** Handoff applies only to planner project chats, not worker/scratch surfaces. */
  handoffAvailable: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  queuedDrafts: QueuedDraft[];
  onEditQueuedDraft: (id: string) => void;
  onDeleteQueuedDraft: (id: string) => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  onReplaceAttachmentText: (index: number, text: string) => void;
  /** Draft attachments already uploaded to the asset store (restored or attach-time uploads). */
  draftAttachments: ChatAttachment[];
  onRemoveDraftAttachment: (index: number) => void;
  onReplaceDraftAttachmentText: (index: number, text: string) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  /** Clear-with-undo (ui15 job 2). */
  clearUndoPending: boolean;
  onClearComposer: () => void;
  onUndoClear: () => void;
  /** Prompt history (ui15 job 2). */
  historyProjectId: string | null;
  historySessionId: string | null;
  onUsePrompt: (content: string, attachments: ChatAttachment[]) => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  isLoading,
  isBootLocked = false,
  onAbortSession,
  effort,
  fastMode,
  availableEffortOptions,
  onSelectEffort,
  onSelectFastMode,
  model,
  provider,
  modelGroups,
  onSelectModel,
  modelsLoading,
  tokenBudget,
  onToggleCommandMenu,
  onHandoff,
  handoffAvailable,
  onSubmit,
  queuedDrafts,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  attachedFiles,
  onRemoveAttachment,
  onReplaceAttachmentText,
  draftAttachments,
  onRemoveDraftAttachment,
  onReplaceDraftAttachmentText,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getInputProps,
  openAttachmentPicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  clearUndoPending,
  onClearComposer,
  onUndoClear,
  historyProjectId,
  historySessionId,
  onUsePrompt,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  useEffect(() => {
    const dropdown = fileDropdownRef.current;
    const selectedFile = selectedFileRef.current;
    if (!showFileDropdown || !dropdown || !selectedFile) {
      return;
    }

    const itemTop = selectedFile.offsetTop;
    const itemBottom = itemTop + selectedFile.offsetHeight;
    const visibleTop = dropdown.scrollTop;
    const visibleBottom = visibleTop + dropdown.clientHeight;

    if (itemTop < visibleTop) {
      dropdown.scrollTop = itemTop;
    } else if (itemBottom > visibleBottom) {
      dropdown.scrollTop = itemBottom - dropdown.clientHeight;
    }
  }, [selectedFileIndex, showFileDropdown]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  const queuedCardEntries = useCollapsingQueuedCards(queuedDrafts);
  const hasQueuedDraft = queuedDrafts.length > 0;
  const hasAttachments = attachedFiles.length > 0 || draftAttachments.length > 0;
  const canQueueDraft = isLoading && Boolean(input.trim() || hasAttachments);
  const canClear = Boolean(input.length > 0 || hasAttachments);
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.addAnother', { defaultValue: 'Queue another message' })
      : t('input.queue.sendNext', { defaultValue: 'Queue next message' })
    : isLoading
      ? t('input.stop')
      : t('input.send');

  return (
    <div className="chat-composer-shell relative px-2 pt-0 sm:px-4 md:px-4">
      {/* The shell floats over the transcript (ui12 phase 3): only this
          column takes pointer events and paints a backdrop, so the
          scrollbar in the right gutter stays visible and grabbable down to
          the viewport bottom. */}
      {/* Bottom padding (ui14 job 11): the home-indicator inset with no
          keyboard, a plain 8px once the keyboard is up (the inset would leave
          a dead band between the bar and the keyboard's top edge). The var is
          set in index.css and switched by the app's visualViewport hook. */}
      <div className="pointer-events-auto mx-auto w-full max-w-[54.25rem] bg-background pb-[var(--composer-bottom-pad)] sm:pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6">
      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {/* Queued messages stack in queue order above the composer (ui15 job
          2), each its own card; a delivered or deleted card ramps closed. */}
      {queuedCardEntries.length > 0 && (
        <div className="mx-auto max-w-[54.25rem]">
          {queuedCardEntries.map(({ draft, leaving }) => (
            <div
              key={draft.id}
              data-slot="queued-card-shell"
              data-leaving={leaving || undefined}
            >
              <div className="min-h-0 overflow-hidden pb-2">
                <QueuedMessageCard
                  content={draft.content}
                  attachmentCount={
                    draft.uploadedAttachments?.length ?? draft.attachments.length
                  }
                  onEdit={() => onEditQueuedDraft(draft.id)}
                  onDelete={() => onDeleteQueuedDraft(draft.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div
            ref={fileDropdownRef}
            className="popout-enter popout-enter-up absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-lg border border-border/50 bg-card/95 shadow-lg backdrop-blur-md"
          >
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                ref={index === selectedFileIndex ? selectedFileRef : undefined}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptHistoryPanel
          open={historyOpen}
          onClose={closeHistory}
          projectId={historyProjectId}
          sessionId={historySessionId}
          onUsePrompt={onUsePrompt}
        />

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
        >
          {hasAttachments && (
            /* Inline attachment previews (claude.ai composer): bordered square
               thumbnails ride above the text inside the enclosure, left-aligned
               with it, scrolling horizontally when they overflow the row. */
            <PromptInputHeader className="flex gap-2 overflow-x-auto">
              {draftAttachments.map((attachment, index) => (
                <ComposerAttachment
                  key={attachment.path || `${attachment.name}-${index}`}
                  descriptor={attachment}
                  onRemove={() => onRemoveDraftAttachment(index)}
                  onReplaceText={(text) => onReplaceDraftAttachmentText(index, text)}
                />
              ))}
              {attachedFiles.map((file, index) => (
                <ComposerAttachment
                  key={`${file.name}-${file.lastModified}-${index}`}
                  file={file}
                  onRemove={() => onRemoveAttachment(index)}
                  onReplaceText={(text) => onReplaceAttachmentText(index, text)}
                  uploadProgress={uploadingFiles.get(file.name)}
                  error={fileErrors.get(file.name)}
                />
              ))}
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          {/* Full-width text row above the controls row (ui15 job 2, the
              claude.ai layout): the textarea spans the enclosure with no
              flanking button columns. */}
          <PromptInputBody className="w-full">
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-3 pb-1 pt-2 text-base leading-6 text-transparent md:text-[13px] md:leading-5">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={isBootLocked ? t('input.bootLocked', { defaultValue: 'Starting session...' }) : placeholder}
              disabled={isBootLocked}
              className="px-3 pb-1 pt-2 md:text-[13px] md:leading-5"
            />
          </PromptInputBody>

          {/* The enclosure holds only prompt-making controls: plus and its
              clear/undo companion, voice, then send on the right (ui16 job
              1). Session utilities live in the separate row below. */}
          <div data-slot="composer-input-controls" className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
            <ComposerPlusMenu
              onUpload={openAttachmentPicker}
              onSlashCommands={onToggleCommandMenu}
              className="ml-0.5 h-7 w-7"
            />

            <PromptInputTools className="min-w-0 gap-1.5">
              {clearUndoPending ? (
                <button
                  type="button"
                  data-slot="composer-undo-clear"
                  onClick={onUndoClear}
                  className="touch-hit relative flex h-7 items-center rounded-md px-1.5 pb-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t('input.undoClear', { defaultValue: 'Undo?' })}
                  <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-sm bg-muted-foreground/20">
                    <span className="undo-deplete block h-full w-full rounded-sm bg-muted-foreground/60" />
                  </span>
                </button>
              ) : canClear ? (
                <button
                  type="button"
                  data-slot="composer-clear"
                  onClick={onClearComposer}
                  aria-label={t('input.clear', { defaultValue: 'Clear message' })}
                  className="touch-hit relative grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <XIcon aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}

              {onVoiceTranscript && voiceAvailable && (
                <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} className="h-7 w-7" />
              )}
            </PromptInputTools>

            <div className="min-w-0 flex-1" />

            <PromptInputSubmit
              className="h-7 w-7"
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                  : isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStop({ send: true });
                        }
                      : undefined
              }
              disabled={
                isLoading
                  ? false
                  : isRecording
                    ? false
                    : isTranscribing
                      ? true
                      : !input.trim() && !hasAttachments
              }
              aria-label={submitAriaLabel}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canQueueDraft ? (
                <ArrowUpIcon className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>
          </div>
        </PromptInput>

        {/* Full-width row below the enclosure (ui16 job 1): the character
            count stays flush left; pane/session utilities keep their existing
            order and height on the right. */}
        <div
          data-slot="composer-controls-row"
          className="mt-1 flex min-w-0 items-center justify-between gap-2"
        >
          <span
            data-slot="char-counter"
            className="h-7 min-w-5 shrink-0 px-0.5 pt-2 font-mono text-[10px] font-medium tabular-nums text-muted-foreground"
            aria-label={t('input.characterCount', {
              defaultValue: '{{count}} characters',
              count: input.length,
            })}
          >
            {input.length.toLocaleString('en-US')}
          </span>

          <div data-slot="composer-controls-right" className="flex min-w-0 shrink items-center gap-1">
            {handoffAvailable && (
              <PromptInputButton
                onClick={onHandoff}
                aria-label={t('input.handoff', { defaultValue: 'Handoff' })}
                tooltip={{ content: t('input.handoff', { defaultValue: 'Handoff' }) }}
                className="h-7 w-7 shrink-0"
                data-slot="composer-handoff"
              >
                <FileTextIcon />
              </PromptInputButton>
            )}

            <PromptInputButton
              onClick={() => setHistoryOpen((previous) => !previous)}
              aria-label={t('input.history.title', { defaultValue: 'Prompt history' })}
              aria-pressed={historyOpen}
              tooltip={{ content: t('input.history.title', { defaultValue: 'Prompt history' }) }}
              className={`h-7 w-7 shrink-0 ${historyOpen ? 'bg-accent/60 text-foreground' : ''}`}
              data-slot="composer-history-toggle"
            >
              <History />
            </PromptInputButton>

            <ComposerModelMenu
              effort={effort}
              fastMode={fastMode}
              effortOptions={availableEffortOptions}
              onSelectEffort={onSelectEffort}
              onSelectFastMode={onSelectFastMode}
              model={model}
              provider={provider}
              modelGroups={modelGroups}
              onSelectModel={onSelectModel}
              modelsLoading={modelsLoading}
            />

            <TokenUsageSummary usage={tokenBudget} />
          </div>
        </div>
      </div>}
      </div>
    </div>
  );
}
