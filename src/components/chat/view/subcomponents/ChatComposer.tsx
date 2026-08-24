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
import { PlusIcon, FileTextIcon, XIcon, Loader2, ArrowUpIcon, Pencil } from 'lucide-react';
import type { SVGProps } from 'react';

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
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ComposerAttachment from './ComposerAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessageCard from './QueuedMessageCard';
import ComposerModelMenu from './ComposerModelMenu';
import { NumberTicker } from '../../../../shared/view/beui/NumberTicker';

// Slash-commands icon drawn in the plus icon's visual language: one diagonal
// stroke whose length (14 units) and stroke width match a single plus arm.
function CommandSlashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.95 7.05 7.05 16.95" />
    </svg>
  );
}

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
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  /** Non-null while the composer holds a past message for edit-and-resend. */
  isEditingMessage?: boolean;
  onCancelEditMessage?: () => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  /** Draft attachments already uploaded to the asset store (restored or attach-time uploads). */
  draftAttachments: ChatAttachment[];
  onRemoveDraftAttachment: (index: number) => void;
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
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  isEditingMessage = false,
  onCancelEditMessage,
  attachedFiles,
  onRemoveAttachment,
  draftAttachments,
  onRemoveDraftAttachment,
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
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-0 sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] md:px-4 md:pb-6">
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
        {isEditingMessage && (
          /* Edit-and-resend indicator: sending silently replaces the edited
             exchange; the X drops the edit and keeps the typed text. */
          <div
            data-slot="composer-edit-indicator"
            className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Pencil className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span className="truncate">
                {t('input.editingMessage', { defaultValue: 'Editing a previous message. Sending replaces its response.' })}
              </span>
            </span>
            <button
              type="button"
              onClick={onCancelEditMessage}
              title={t('input.cancelEdit', { defaultValue: 'Cancel edit' })}
              aria-label={t('input.cancelEdit', { defaultValue: 'Cancel edit' })}
              className="relative touch-hit inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {showFileDropdown && filteredFiles.length > 0 && (
          <div
            ref={fileDropdownRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-lg border border-border/50 bg-card/95 shadow-lg backdrop-blur-md"
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
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
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
            <PromptInputHeader>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {draftAttachments.map((attachment, index) => (
                    <ComposerAttachment
                      key={attachment.path || `${attachment.name}-${index}`}
                      descriptor={attachment}
                      onRemove={() => onRemoveDraftAttachment(index)}
                    />
                  ))}
                  {attachedFiles.map((file, index) => (
                    <ComposerAttachment
                      key={`${file.name}-${file.lastModified}-${index}`}
                      file={file}
                      onRemove={() => onRemoveAttachment(index)}
                      uploadProgress={uploadingFiles.get(file.name)}
                      error={fileErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-base leading-6 text-transparent md:text-sm">
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
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools className="min-w-0">
            <PromptInputButton
              tooltip={{ content: t('input.attachFiles') }}
              onClick={openAttachmentPicker}
              aria-label={t('input.attachFiles')}
            >
              <PlusIcon />
            </PromptInputButton>

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
            )}

            <PromptInputButton
              tooltip={{ content: t('input.showAllCommands') }}
              onClick={onToggleCommandMenu}
              className="relative"
            >
              <CommandSlashIcon />
            </PromptInputButton>

            {handoffAvailable && (
              <PromptInputButton
                tooltip={{ content: t('input.handoff', { defaultValue: 'Handoff' }) }}
                onClick={onHandoff}
                aria-label={t('input.handoff', { defaultValue: 'Handoff' })}
              >
                <FileTextIcon />
              </PromptInputButton>
            )}

            <TokenUsageSummary usage={tokenBudget} />

            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
              >
                <XIcon />
              </PromptInputButton>
            )}

          </PromptInputTools>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {input.length > 0 && (
              <span
                data-slot="char-counter"
                title={t('input.characterCount', { defaultValue: 'Characters' })}
                className="text-[10px] font-medium tabular-nums text-muted-foreground"
              >
                <NumberTicker value={input.length} locale duration={0.35} stagger={0} startOnView={false} />
              </span>
            )}
            <ComposerModelMenu
              effort={effort}
              effortOptions={availableEffortOptions}
              onSelectEffort={onSelectEffort}
              model={model}
              modelOptions={availableModelOptions}
              onSelectModel={onSelectModel}
              modelsLoading={modelsLoading}
            />

            <PromptInputSubmit
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
              title={submitAriaLabel}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canQueueDraft ? (
                <ArrowUpIcon className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
