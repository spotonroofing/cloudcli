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
import { Loader2, ArrowUpIcon } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { ChatAttachment, PendingPermissionRequest } from '../../types/types';
import type { ProviderModelOption } from '../../../../types/app';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
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
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  tokenBudget: Record<string, unknown> | null;
  onToggleCommandMenu: () => void;
  onHandoff: () => void;
  /** Handoff applies only to planner project chats, not worker/scratch surfaces. */
  handoffAvailable: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
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
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
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
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  isLoading,
  isBootLocked = false,
  onAbortSession,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  tokenBudget,
  onToggleCommandMenu,
  onHandoff,
  handoffAvailable,
  onSubmit,
  isDragActive,
  queuedDraft,
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
  getRootProps,
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
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const fileDropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
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

  const hasQueuedDraft = Boolean(queuedDraft);
  const hasAttachments = attachedFiles.length > 0 || draftAttachments.length > 0;
  const canQueueDraft = isLoading && Boolean(input.trim() || hasAttachments);
  const submitAriaLabel = canQueueDraft
    ? hasQueuedDraft
      ? t('input.queue.update', { defaultValue: 'Update queued message' })
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
      <div className="pointer-events-auto mx-auto w-full max-w-[54.25rem] bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6">
      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
          />
        </div>
      )}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={
            queuedDraft.uploadedAttachments?.length ?? queuedDraft.attachments.length
          }
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
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

        <PromptInput
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          status={isLoading ? 'streaming' : 'ready'}
          className={isTextareaExpanded ? 'chat-input-expanded' : ''}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-lg border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {hasAttachments && (
            /* Inline attachment previews (claude.ai composer): bordered square
               thumbnails sit directly above the text inside the enclosure — no
               gray container. */
            <PromptInputHeader className="flex flex-wrap gap-2">
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

          {/* Input row (Claude-desktop style): plus flanks the text left, send
              flanks it right; items-end pins the controls to the last text line
              so a long draft stacks above them. The plus opens the drawer menu
              of composer actions (ui13 job 12): upload, slash commands, handoff. */}
          <div data-slot="composer-input-row" className="flex items-end gap-1 px-2 pb-1.5 pt-1">
            <ComposerPlusMenu
              onUpload={openAttachmentPicker}
              onSlashCommands={onToggleCommandMenu}
              onHandoff={onHandoff}
              handoffAvailable={handoffAvailable}
              className="mb-0.5 ml-0.5 h-7 w-7"
            />

            <PromptInputBody className="min-w-0 flex-1">
              <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
                <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-2 py-1.5 text-base leading-6 text-transparent md:text-[13px] md:leading-5">
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
                className="px-2 py-1.5 md:text-[13px] md:leading-5"
              />
            </PromptInputBody>

            <div className="mb-0.5 flex shrink-0 items-center gap-1.5">
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
          </div>
      </PromptInput>

        {/* Slim secondary row (ui11 phase 5, ui12 phase 2, ui13 job 12, ui14
            job 6): floats under the enclosure, outside its border. Left: the
            character counter flush with the enclosure's left edge (plain
            tabular text, always shown, "0" before typing), then voice. Right:
            model selector + context ring, the ring flush with the right edge.
            No horizontal padding on the row. */}
        <div
          data-slot="composer-secondary-row"
          className="mt-1 flex items-center justify-between gap-2"
        >
            <PromptInputTools className="min-w-0 gap-1.5">
              <span
                data-slot="char-counter"
                className="font-mono text-[10px] font-medium tabular-nums text-muted-foreground"
              >
                {input.length.toLocaleString('en-US')}
              </span>

              {onVoiceTranscript && voiceAvailable && (
                <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} className="h-7 w-7" />
              )}
            </PromptInputTools>

            <div className="flex shrink-0 items-center gap-1.5">
              <ComposerModelMenu
                effort={effort}
                effortOptions={availableEffortOptions}
                onSelectEffort={onSelectEffort}
                model={model}
                modelOptions={availableModelOptions}
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
